import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createWritingFiles, type WritingFileApi } from "./writing.files";
import {
  createWritingStore,
  newWritingAnnotation,
  saveWritingAnnotation,
  type WritingDocument,
} from "./writing.logic";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const disk = new Map<string, string>();
  const folder = {
    environmentId: EnvironmentId.make("writing-test-environment"),
    projectId: ProjectId.make("writing-test-project"),
    path: "/writing",
  };
  const write = vi.fn<WritingFileApi["write"]>(async (_folder, path, contents, expected) => {
    if ((disk.get(path) ?? null) !== expected) throw new Error("The file changed.");
    disk.set(path, contents);
  });
  const api: WritingFileApi = {
    read: async (_folder, path) => disk.get(path) ?? null,
    write,
    list: async () => [...disk.keys()].filter((path) => !path.includes("/")),
    ensure: async () => folder,
  };
  const store = createWritingStore(storage);
  const files = createWritingFiles(store, api, storage);
  const attach = () =>
    files.open({
      environmentId: folder.environmentId,
      path: folder.path,
      name: "My writing",
      create: false,
      existingProjectId: store.getSnapshot().workspace.projects[0]!.id,
    });
  return { store, files, storage, disk, api, folder, write, attach };
}

it("copies existing drafts to Markdown and metadata and restores them in another browser", async () => {
  const { store, files, storage, disk, api, folder, attach } = fixture();
  const id = store.getSnapshot().workspace.activeDocumentId;
  store.updateDocument(id, (document) => {
    const text = "A heading\nA point\nA quotation";
    return saveWritingAnnotation(
      {
        ...document,
        title: "The draft",
        text,
        context: "Explain an idea.",
        blocks: [
          { kind: "h2", text: "A heading" },
          { kind: "bullet", text: "A point" },
          { kind: "quote", text: "A quotation" },
        ],
      },
      newWritingAnnotation(text, 0, 9, "comment", "Clarify the heading.", "todo"),
    );
  });
  await attach();
  const saved = store.getSnapshot().workspace.documents.find((document) => document.id === id)!;
  expect(disk.get(saved.fileName!)).toContain("## A heading\n\n- A point\n\n> A quotation");
  expect(disk.has(".whisk/project.json")).toBe(true);
  expect(files.getSnapshot()[saved.projectId]!.phase).toBe("saved");
  const otherStorage = { getItem: () => null, setItem: () => {} };
  const other = createWritingStore(otherStorage);
  const otherFiles = createWritingFiles(other, api, otherStorage);
  await otherFiles.open({
    environmentId: folder.environmentId,
    path: "/writing",
    name: "Open",
    create: false,
  });
  const restored = other.getSnapshot().workspace.documents.find((document) => document.id === id)!;
  expect(restored).toEqual(saved);
  expect(restored.todos[0]!.text).toBe("Clarify the heading.");
  expect(
    createWritingStore(storage)
      .getSnapshot()
      .workspace.documents.find((document) => document.id === id),
  ).toEqual(saved);
});

it("refuses to overwrite an external edit and reloads it alongside a separate recovery draft", async () => {
  const { store, files, disk, write, attach } = fixture();
  const id = store.getSnapshot().workspace.activeDocumentId;
  store.updateDocument(id, (document) => ({ ...document, title: "Draft", text: "Original text." }));
  await attach();
  const original = store.getSnapshot().workspace.documents.find((document) => document.id === id)!;
  disk.set(original.fileName!, "# External title\n\nExternal text.\n");
  const metadata = disk.get(`.whisk/documents/${id}.json`);
  write.mockClear();
  store.updateDocument(id, (document) => ({ ...document, text: "My unsaved changes." }));
  await files.flush(original.projectId);
  expect(files.getSnapshot()[original.projectId]!.phase).toBe("error");
  expect(write).not.toHaveBeenCalled();
  expect(disk.get(original.fileName!)).toContain("External text.");
  expect(disk.get(`.whisk/documents/${id}.json`)).toBe(metadata);
  await files.reload(original.projectId);
  const workspace = store.getSnapshot().workspace;
  expect(workspace.documents.find((document) => document.id === id)!.text).toBe("External text.");
  const recovered = workspace.projects.find((project) => project.name.includes("recovered draft"))!;
  expect(recovered.folder).toBeNull();
  expect(workspace.documents.find((document) => document.projectId === recovered.id)!.text).toBe(
    "My unsaved changes.",
  );
});

it("recovers a partially completed save without replacing a later edit or losing metadata", async () => {
  const { store, files, disk, write, attach } = fixture();
  await attach();
  const original = store.getSnapshot().workspace.documents[0]!;
  let fail = true;
  write.mockImplementation(async (_folder, path, contents, expected) => {
    if (fail && path.includes("/documents/")) {
      fail = false;
      throw new Error("Disconnected during metadata save.");
    }
    if ((disk.get(path) ?? null) !== expected) throw new Error("The file changed.");
    disk.set(path, contents);
  });
  store.updateDocument(original.id, (document) => ({
    ...document,
    text: "Keep this new draft.",
    context: "New intent.",
  }));
  await files.flush(original.projectId);
  expect(files.getSnapshot()[original.projectId]!.phase).toBe("error");
  expect(disk.get(original.fileName!)).toContain("Keep this new draft.");
  await files.flush(original.projectId);
  expect(files.getSnapshot()[original.projectId]!.phase).toBe("saved");
  const metadata = JSON.parse(disk.get(`.whisk/documents/${original.id}.json`)!) as {
    document: WritingDocument;
  };
  expect(metadata.document.context).toBe("New intent.");
  expect(metadata.document.text).toBe("Keep this new draft.");
});

it("imports existing Markdown without rewriting it when only notes or design change", async () => {
  const { store, files, disk, folder } = fixture();
  const markdown = "# Existing\n\n## A section\n\n- One\n- Two\n\n> A quote\n";
  disk.set("Existing.md", markdown);
  await files.open({
    environmentId: folder.environmentId,
    path: folder.path,
    name: "Existing folder",
    create: false,
  });
  const document = store
    .getSnapshot()
    .workspace.documents.find((item) => item.fileName === "Existing.md")!;
  expect(document.blocks.map((block) => block.kind)).toEqual(["h2", "bullet", "bullet", "quote"]);
  expect(disk.get("Existing.md")).toBe(markdown);
  store.updateDocument(document.id, (current) => ({
    ...current,
    context: "A note about the project.",
  }));
  await files.flush(document.projectId);
  expect(disk.get("Existing.md")).toBe(markdown);
});

it("serializes edits made during an in-flight save and leaves file bindings detached on backup import", async () => {
  const { store, files, api, disk, attach } = fixture();
  await attach();
  const original = store.getSnapshot().workspace.documents[0]!;
  let release: (() => void) | undefined;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const write = api.write;
  let intercept = true;
  api.write = async (...input) => {
    if (intercept) {
      intercept = false;
      await blocked;
    }
    await write(...input);
  };
  store.updateDocument(original.id, (document) => ({ ...document, text: "First edit." }));
  const saving = files.flush(original.projectId);
  store.updateDocument(original.id, (document) => ({
    ...document,
    text: "Second edit while saving.",
  }));
  release!();
  await saving;
  expect(disk.get(original.fileName!)).toContain("Second edit while saving.");
  const backup = JSON.stringify(store.getSnapshot().workspace);
  store.importBackup(backup);
  expect(store.getSnapshot().workspace.projects.every((project) => project.folder === null)).toBe(
    true,
  );
  expect(
    store.getSnapshot().workspace.documents.find((document) => document.id === original.id)!.text,
  ).toBe("Second edit while saving.");
});

it("resumes unsaved browser changes on startup using the last confirmed file versions", async () => {
  const { store, api, storage, disk, attach } = fixture();
  await attach();
  const original = store.getSnapshot().workspace.documents[0]!;
  store.updateDocument(original.id, (document) => ({
    ...document,
    text: "Typed just before closing.",
  }));
  const restored = createWritingStore(storage);
  const restarted = createWritingFiles(restored, api, storage);
  const stop = restarted.start();
  try {
    await restarted.flush(original.projectId);
    expect(restarted.getSnapshot()[original.projectId]!.phase).toBe("saved");
    expect(disk.get(original.fileName!)).toContain("Typed just before closing.");
    expect(restored.getSnapshot().workspace.documents[0]!.text).toBe("Typed just before closing.");
  } finally {
    stop();
  }
});

it("preserves imported numbered-list starts and unsupported Markdown source", async () => {
  const { store, files, disk, folder } = fixture();
  const markdown =
    "# Existing\n\nA [reference](https://example.com) and **emphasis**.\n\n5. Fifth\n6. Sixth\n\n```js\nconst answer = 42;\n```\n\n![Diagram](diagram.png)\n";
  disk.set("Existing.MD", markdown);
  await files.open({
    environmentId: folder.environmentId,
    path: folder.path,
    name: "Existing",
    create: false,
  });
  const document = store
    .getSnapshot()
    .workspace.documents.find((item) => item.fileName === "Existing.MD")!;
  expect(
    document.blocks.filter((block) => block.kind === "number").map((block) => block.numberStart),
  ).toEqual([5, 6]);
  expect(document.text).toContain("[reference](https://example.com)");
  expect(document.text).toContain("const answer = 42;");
  expect(document.text).toContain("![Diagram](diagram.png)");
  store.updateDocument(document.id, (current) => ({
    ...current,
    context: "Keep the original source.",
  }));
  await files.flush(document.projectId);
  expect(disk.get("Existing.MD")).toBe(markdown);
});

it("leaves corrupted project metadata and unrelated files untouched", async () => {
  const { store, disk, attach, write } = fixture();
  disk.set(".whisk/project.json", "not valid JSON");
  disk.set("important.md", "Never overwrite me.");
  const before = store.getSnapshot().workspace;
  await expect(attach()).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
  expect(store.getSnapshot().workspace).toBe(before);
  expect(disk.get("important.md")).toBe("Never overwrite me.");
});

it("keeps open drafts when a copied folder reuses project or document identities", async () => {
  const { store, files, disk, api, folder, attach, write } = fixture();
  await attach();
  const original = store.getSnapshot().workspace.documents[0]!;
  store.updateDocument(original.id, (document) => ({
    ...document,
    text: "Unsaved original draft.",
  }));
  const before = store.getSnapshot().workspace;
  api.ensure = async () => ({ ...folder, path: "/copied-folder" });
  const openCopy = () =>
    files.open({
      environmentId: folder.environmentId,
      path: "/copied-folder",
      name: "Copy",
      create: false,
    });
  write.mockClear();
  await expect(openCopy()).rejects.toThrow("already open from another location");
  expect(store.getSnapshot().workspace).toBe(before);
  expect(write).not.toHaveBeenCalled();

  const manifest = JSON.parse(disk.get(".whisk/project.json")!) as { id: string };
  manifest.id = "different-project";
  disk.set(".whisk/project.json", JSON.stringify(manifest));
  const path = `.whisk/documents/${original.id}.json`;
  const metadata = JSON.parse(disk.get(path)!) as { document: WritingDocument };
  metadata.document = { ...metadata.document, projectId: manifest.id };
  disk.set(path, JSON.stringify(metadata));
  await expect(openCopy()).rejects.toThrow("identity is already used by another project");
  expect(store.getSnapshot().workspace).toBe(before);
  expect(write).not.toHaveBeenCalled();
});
