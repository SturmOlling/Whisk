import * as Schema from "effect/Schema";
import { sha256 } from "@noble/hashes/sha2";
import { randomUUID } from "../lib/utils";
import {
  decodeWritingDocument,
  documentMarkdown,
  newWritingDocument,
  type WritingDocument,
  type WritingFolder,
  type WritingProject,
  type WritingStore,
} from "./writing.logic";
import { documentFromMarkdown } from "./writing.format";

export interface WritingFileApi {
  read: (folder: WritingFolder, path: string) => Promise<string | null>;
  write: (
    folder: WritingFolder,
    path: string,
    contents: string,
    expectedContents: string | null,
  ) => Promise<void>;
  list: (folder: WritingFolder) => Promise<readonly string[]>;
  ensure: (
    environmentId: WritingFolder["environmentId"],
    path: string,
    name: string,
    create: boolean,
  ) => Promise<WritingFolder>;
}

const MANIFEST = ".whisk/project.json";
const CACHE_KEY = "whisk:file-recovery:v1";
const FileName = Schema.String.check(Schema.isPattern(/^[^/\\\0]+\.md$/i));
const decodeManifest = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
      name: Schema.String.check(Schema.isMaxLength(2_000)),
      documents: Schema.Array(
        Schema.Struct({
          id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2_000)),
          fileName: FileName,
        }),
      ).check(Schema.isMinLength(1)),
    }),
  ),
);
const decodeMetadata = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      version: Schema.Literal(1),
      document: Schema.Unknown,
      markdown: Schema.String,
    }),
  ),
);
const decodeCache = Schema.decodeSync(
  Schema.fromJsonString(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        saved: Schema.String,
        hashes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
      }),
    ),
  ),
);
type CacheEntry = { saved: string; hashes: Record<string, string | null> };
export interface WritingFileStatus {
  phase: "loading" | "saving" | "saved" | "error";
  message: string;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
async function hash(value: string | null): Promise<string | null> {
  if (value === null) return null;
  return [...sha256(new TextEncoder().encode(value))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function folderKey(folder: WritingFolder) {
  return canonical([folder.environmentId, folder.path]);
}
function digest(value: unknown) {
  return [...sha256(new TextEncoder().encode(canonical(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function projectDigest(project: WritingProject, documents: readonly WritingDocument[]) {
  return digest({ project, documents });
}
function bodyDigest(document: WritingDocument) {
  return digest([document.title, document.text, document.blocks]);
}
function metadataPath(id: string) {
  return `.whisk/documents/${encodeURIComponent(id)}.json`;
}
function fileNameFor(document: WritingDocument): string {
  const title =
    (document.title || "Untitled")
      .normalize("NFKC")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .slice(0, 60)
      .replace(/^-+|-+$/g, "") || "Untitled";
  const suffix = document.id.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 36);
  if (!suffix) throw new Error("This document needs a valid file identity. Export a backup first.");
  return `${title}--${suffix}.md`;
}

/** A serial queue per project, guarded writes, and browser recovery until the whole save lands. */
export function createWritingFiles(
  store: WritingStore,
  api: WritingFileApi,
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  let statuses: Readonly<Record<string, WritingFileStatus>> = {};
  const listeners = new Set<() => void>();
  const cache: Record<string, CacheEntry> = {};
  try {
    Object.assign(cache, decodeCache(storage.getItem(CACHE_KEY) ?? "{}"));
  } catch {
    /* Missing recovery metadata never grants overwrite access. */
  }
  const markdowns = new Map<string, { body: string; raw: string }>();
  const queues = new Map<string, Promise<void>>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const attempted = new Map<string, string>();
  let paused = 0;
  let unsubscribe: (() => void) | null = null;
  let active = false;
  const report = (id: string, phase: WritingFileStatus["phase"], message: string) => {
    statuses = { ...statuses, [id]: { phase, message } };
    for (const listener of listeners) listener();
  };
  const saveCache = () => {
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* The original drafts remain in memory and folder errors are reported separately. */
    }
  };
  const quietUpdate = (change: Parameters<WritingStore["update"]>[0]) => {
    paused++;
    try {
      store.update(change);
    } finally {
      paused--;
    }
  };
  const snapshotProject = (id: string) => {
    const workspace = store.getSnapshot().workspace;
    const project = workspace.projects.find((item) => item.id === id);
    return project
      ? { project, documents: workspace.documents.filter((document) => document.projectId === id) }
      : null;
  };

  const readProject = async (folder: WritingFolder, fallback: WritingProject) => {
    const hashes: Record<string, string | null> = {};
    const read = async (path: string) => {
      const raw = await api.read(folder, path);
      hashes[path] = await hash(raw);
      return raw;
    };
    const rawManifest = await read(MANIFEST);
    let project = fallback;
    const documents: WritingDocument[] = [];
    if (rawManifest !== null) {
      const manifest = decodeManifest(rawManifest);
      if (
        new Set(manifest.documents.map((item) => item.id)).size !== manifest.documents.length ||
        new Set(manifest.documents.map((item) => item.fileName)).size !== manifest.documents.length
      )
        throw new Error(
          "This project has duplicate document identities. Its files were left untouched.",
        );
      project = { id: manifest.id, name: manifest.name, folder };
      for (const entry of manifest.documents) {
        const markdown = await read(entry.fileName);
        const metadata = await read(metadataPath(entry.id));
        if (markdown === null || metadata === null)
          throw new Error(
            `A file for ${entry.fileName} is missing. Your browser copy is preserved.`,
          );
        const decoded = decodeMetadata(metadata);
        let document = decodeWritingDocument(JSON.stringify(decoded.document));
        if (
          document.id !== entry.id ||
          document.projectId !== project.id ||
          document.fileName !== entry.fileName
        )
          throw new Error(
            "A document's metadata does not match this project. Files were left untouched.",
          );
        if (decoded.markdown !== markdown)
          document = decodeWritingDocument(
            JSON.stringify(documentFromMarkdown(markdown, document)),
          );
        markdowns.set(`${folderKey(folder)}:${entry.fileName}`, {
          body: bodyDigest(document),
          raw: markdown,
        });
        documents.push(document);
      }
    } else {
      for (const fileName of await api.list(folder)) {
        if (!/^[^/\\\0]+\.md$/i.test(fileName)) continue;
        const markdown = await read(fileName);
        if (markdown === null) continue;
        const document = decodeWritingDocument(
          JSON.stringify(
            documentFromMarkdown(markdown, {
              ...newWritingDocument(project.id),
              title: fileName.replace(/\.md$/i, ""),
              fileName,
            }),
          ),
        );
        hashes[metadataPath(document.id)] = null;
        markdowns.set(`${folderKey(folder)}:${fileName}`, {
          body: bodyDigest(document),
          raw: markdown,
        });
        documents.push(document);
      }
    }
    return { project, documents, hashes, existing: rawManifest !== null };
  };

  const persist = async (id: string) => {
    for (;;) {
      const snapshot = snapshotProject(id);
      if (!snapshot?.project.folder) return;
      const { project } = snapshot;
      const folder = project.folder!;
      const key = folderKey(folder);
      const entry = (cache[key] ??= { saved: "", hashes: {} });
      const allocated = snapshot.documents.map((document) => ({
        ...document,
        fileName: document.fileName ?? fileNameFor(document),
      }));
      if (new Set(allocated.map((document) => document.fileName)).size !== allocated.length)
        throw new Error("Two documents would use the same file. Export a backup before retrying.");
      quietUpdate((state) => ({
        ...state,
        documents: state.documents.map((document) =>
          document.projectId === id && document.fileName === null
            ? { ...document, fileName: allocated.find((item) => item.id === document.id)!.fileName }
            : document,
        ),
      }));
      const digest = projectDigest(project, allocated);
      if (digest === entry.saved) {
        report(id, "saved", "Saved to folder");
        return;
      }
      report(id, "saving", "Saving to folder…");
      const payloads: Array<{ path: string; contents: string }> = [];
      for (const document of allocated) {
        decodeWritingDocument(JSON.stringify(document));
        if (!markdowns.has(`${key}:${document.fileName}`)) {
          const rawMetadata = await api.read(folder, metadataPath(document.id));
          if (rawMetadata !== null) {
            const metadata = decodeMetadata(rawMetadata);
            const previous = decodeWritingDocument(JSON.stringify(metadata.document));
            markdowns.set(`${key}:${document.fileName}`, {
              body: bodyDigest(previous),
              raw: metadata.markdown,
            });
          }
        }
        const remembered = markdowns.get(`${key}:${document.fileName}`);
        const markdown =
          remembered?.body === bodyDigest(document) ? remembered.raw : documentMarkdown(document);
        payloads.push(
          { path: document.fileName!, contents: markdown },
          {
            path: metadataPath(document.id),
            contents: JSON.stringify({ version: 1, document, markdown }, null, 2),
          },
        );
      }
      payloads.push({
        path: MANIFEST,
        contents: JSON.stringify(
          {
            version: 1,
            id: project.id,
            name: project.name,
            documents: allocated.map((document) => ({
              id: document.id,
              fileName: document.fileName,
            })),
          },
          null,
          2,
        ),
      });
      // Check every file before writing any, including files a different client may have changed.
      const current = new Map<string, string | null>();
      for (const file of payloads) {
        if (file.path.length > 512 || new TextEncoder().encode(file.contents).length > 1_000_000)
          throw new Error(
            "This document's metadata is too large to save safely. Export a workspace backup.",
          );
        const raw = await api.read(folder, file.path);
        current.set(file.path, raw);
        if ((await hash(raw)) !== (entry.hashes[file.path] ?? null))
          throw new Error(
            `“${file.path}” changed outside Whisk. Your draft is kept here. Reload the folder to keep both versions.`,
          );
      }
      for (const file of payloads) {
        const raw = current.get(file.path) ?? null;
        if (raw !== file.contents) await api.write(folder, file.path, file.contents, raw);
        entry.hashes[file.path] = await hash(file.contents);
        saveCache();
      }
      for (const document of allocated)
        markdowns.set(`${key}:${document.fileName}`, {
          body: bodyDigest(document),
          raw: payloads.find((file) => file.path === document.fileName)!.contents,
        });
      entry.saved = digest;
      saveCache();
      const latest = snapshotProject(id);
      if (
        !latest ||
        !latest.project.folder ||
        folderKey(latest.project.folder) !== key ||
        projectDigest(latest.project, latest.documents) === digest
      ) {
        report(id, "saved", "Saved to folder");
        return;
      }
    }
  };
  const flush = (id: string): Promise<void> => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    const running = queues.get(id);
    if (running) return running;
    const pending = persist(id)
      .catch((error: unknown) => {
        report(
          id,
          "error",
          error instanceof Error
            ? error.message
            : "Could not save files. Your browser copy is preserved.",
        );
      })
      .finally(() => queues.delete(id));
    queues.set(id, pending);
    return pending;
  };
  const schedule = () => {
    if (paused || !active) return;
    for (const project of store.getSnapshot().workspace.projects) {
      if (!project.folder) continue;
      const documents = snapshotProject(project.id)!.documents;
      const digest = projectDigest(project, documents);
      if (
        cache[folderKey(project.folder)]?.saved === digest ||
        attempted.get(project.id) === digest
      )
        continue;
      attempted.set(project.id, digest);
      const previous = timers.get(project.id);
      if (previous) clearTimeout(previous);
      report(project.id, "saving", "Saving to folder…");
      timers.set(
        project.id,
        setTimeout(() => {
          void flush(project.id);
        }, 600),
      );
    }
  };

  const recover = (project: WritingProject, documents: readonly WritingDocument[]) => {
    if (!documents.length) return;
    const id = randomUUID();
    quietUpdate((state) => ({
      ...state,
      projects: [
        ...state.projects,
        { id, name: `${project.name} (recovered draft)`, folder: null },
      ],
      documents: [
        ...state.documents,
        ...documents.map((document) => ({
          ...document,
          id: randomUUID(),
          projectId: id,
          fileName: null,
        })),
      ],
    }));
  };
  const install = (
    project: WritingProject,
    documents: readonly WritingDocument[],
    replacingId?: string,
  ) => {
    const workspace = store.getSnapshot().workspace;
    const existing = workspace.projects.find((item) => item.id === project.id);
    if (
      existing &&
      existing.id !== replacingId &&
      (!existing.folder ||
        !project.folder ||
        folderKey(existing.folder) !== folderKey(project.folder))
    )
      throw new Error(
        "This project is already open from another location. Its drafts were kept unchanged.",
      );
    const ids = new Set(documents.map((document) => document.id));
    if (
      workspace.documents.some(
        (document) =>
          document.projectId !== project.id &&
          document.projectId !== replacingId &&
          ids.has(document.id),
      )
    )
      throw new Error(
        "A document identity is already used by another project. Your drafts were kept unchanged.",
      );
    quietUpdate((state) => {
      const previous = state.documents.find((document) => document.id === state.activeDocumentId);
      const projects = state.projects.filter(
        (item) => item.id !== project.id && item.id !== replacingId,
      );
      const kept = state.documents.filter(
        (document) => document.projectId !== project.id && document.projectId !== replacingId,
      );
      return {
        ...state,
        projects: [...projects, project],
        documents: [...kept, ...documents],
        activeDocumentId:
          previous?.projectId === project.id || previous?.projectId === replacingId || !previous
            ? (documents.find((document) => document.id === state.activeDocumentId)?.id ??
              documents[0]!.id)
            : state.activeDocumentId,
      };
    });
  };

  const reload = async (id: string) => {
    await queues.get(id);
    const snapshot = snapshotProject(id);
    if (!snapshot?.project.folder) return;
    const folder = snapshot.project.folder;
    report(id, "loading", "Reading folder…");
    try {
      const loaded = await readProject(folder, snapshot.project);
      if (!loaded.documents.length)
        throw new Error("No document files were found. Your draft is preserved.");
      const latest = snapshotProject(id)!;
      if (
        projectDigest(latest.project, latest.documents) !== cache[folderKey(folder)]?.saved &&
        projectDigest(latest.project, latest.documents) !==
          projectDigest(loaded.project, loaded.documents)
      )
        recover(latest.project, latest.documents);
      cache[folderKey(folder)] = {
        saved: projectDigest(loaded.project, loaded.documents),
        hashes: loaded.hashes,
      };
      install(loaded.project, loaded.documents, id);
      saveCache();
      report(loaded.project.id, "saved", "Saved to folder");
    } catch (error) {
      report(
        id,
        "error",
        error instanceof Error
          ? error.message
          : "Could not read the folder. Your browser copy is preserved.",
      );
    }
  };

  return {
    getSnapshot: () => statuses,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush,
    reload,
    start() {
      active = true;
      unsubscribe = store.subscribe(schedule);
      for (const project of store.getSnapshot().workspace.projects) {
        if (!project.folder) continue;
        const snapshot = snapshotProject(project.id)!;
        const entry = cache[folderKey(project.folder)];
        if (entry && entry.saved !== projectDigest(project, snapshot.documents))
          void flush(project.id);
        else void reload(project.id);
      }
      return () => {
        active = false;
        unsubscribe?.();
        for (const timer of timers.values()) clearTimeout(timer);
        timers.clear();
      };
    },
    async open(input: {
      environmentId: WritingFolder["environmentId"];
      path: string;
      name: string;
      create: boolean;
      existingProjectId?: string;
    }) {
      const folder = await api.ensure(input.environmentId, input.path, input.name, input.create);
      const previous = input.existingProjectId ? snapshotProject(input.existingProjectId) : null;
      const loaded = await readProject(folder, {
        id: previous?.project.id ?? randomUUID(),
        name: input.name,
        folder,
      });
      const alreadyOpen = store
        .getSnapshot()
        .workspace.projects.find(
          (project) => project.folder && folderKey(project.folder) === folderKey(folder),
        );
      if (alreadyOpen && alreadyOpen.id !== previous?.project.id) {
        if (previous)
          throw new Error(
            "This folder is already open as another project. Choose another folder for these drafts.",
          );
        const first = snapshotProject(alreadyOpen.id)!.documents[0]!;
        store.update((state) => ({ ...state, activeDocumentId: first.id }));
        return;
      }
      const documents = [...loaded.documents];
      if (previous)
        for (const original of snapshotProject(previous.project.id)!.documents) {
          const found = documents.find((document) => document.id === original.id);
          if (
            found &&
            canonical(found) === canonical({ ...original, projectId: loaded.project.id })
          )
            continue;
          documents.push({
            ...original,
            id: found ? randomUUID() : original.id,
            projectId: loaded.project.id,
            fileName: null,
          });
        }
      if (!documents.length) documents.push(newWritingDocument(loaded.project.id));
      cache[folderKey(folder)] = {
        saved: loaded.existing ? projectDigest(loaded.project, loaded.documents) : "",
        hashes: loaded.hashes,
      };
      saveCache();
      install(loaded.project, documents, previous?.project.id);
      store.update((state) => ({ ...state, activeDocumentId: documents[0]!.id }));
      await flush(loaded.project.id);
      if (statuses[loaded.project.id]?.phase === "error")
        throw new Error(statuses[loaded.project.id]!.message);
    },
  };
}
export type WritingFiles = ReturnType<typeof createWritingFiles>;
