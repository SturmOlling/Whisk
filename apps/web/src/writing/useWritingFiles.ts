import { useEffect, useState } from "react";
import {
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type FilesystemBrowseResult,
} from "@t3tools/contracts";
import {
  executeAtomQuery,
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { filesystemEnvironment } from "../state/filesystem";
import { projectEnvironment } from "../state/projects";
import { readProjects, waitForProject } from "../state/entities";
import { readEnvironmentScope } from "../state/session";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { newProjectId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import { isDesktopLocalConnectionTarget } from "../connection/desktopLocal";
import { createWritingFiles, type WritingFileApi, type WritingFiles } from "./writing.files";
import type { WritingStore } from "./writing.logic";

function value<A, E>(result: AtomCommandResult<A, E>): A {
  if (result._tag === "Failure") {
    const cause = squashAtomCommandFailure(result);
    throw cause instanceof Error ? cause : new Error("The folder operation failed.");
  }
  return result.value;
}
async function browse(environmentId: EnvironmentId, path: string): Promise<FilesystemBrowseResult> {
  if (!readEnvironmentScope(environmentId, AuthFilesystemReadScope))
    throw new Error("This connection cannot browse folders.");
  return value(
    await executeAtomQuery(
      appAtomRegistry,
      filesystemEnvironment.browse({
        environmentId,
        input: { partialPath: /[\\/]$/.test(path) ? path : `${path}/` },
      }),
      { label: "Browse writing folders", reportFailure: false, refresh: true },
    ),
  );
}
const fileApi: WritingFileApi = {
  async read(folder, relativePath) {
    const result = value(
      await executeAtomQuery(
        appAtomRegistry,
        projectEnvironment.readFile({
          environmentId: folder.environmentId,
          input: { cwd: folder.path, relativePath, allowMissing: true },
        }),
        { label: "Read writing file", reportFailure: false, refresh: true },
      ),
    );
    if (result.truncated)
      throw new Error(`${relativePath} is too large to open safely. The file was left untouched.`);
    return result.exists === false ? null : result.contents;
  },
  async write(folder, relativePath, contents, expectedContents) {
    if (!readEnvironmentScope(folder.environmentId, AuthFilesystemWriteScope))
      throw new Error("This connection cannot save files. Your browser draft is preserved.");
    value(
      await runAtomCommand(
        appAtomRegistry,
        projectEnvironment.writeFile,
        {
          environmentId: folder.environmentId,
          input: { cwd: folder.path, relativePath, contents, expectedContents },
        },
        { label: "Save writing file", reportFailure: false },
      ),
    );
  },
  async list(folder) {
    const result = value(
      await executeAtomQuery(
        appAtomRegistry,
        projectEnvironment.listEntries({
          environmentId: folder.environmentId,
          input: { cwd: folder.path },
        }),
        { label: "Open writing folder", reportFailure: false, refresh: true },
      ),
    );
    if (result.truncated)
      throw new Error(
        "This folder has too many entries to import safely. Choose a smaller writing folder.",
      );
    return result.entries.filter((entry) => entry.kind === "file").map((entry) => entry.path);
  },
  async ensure(environmentId, path, name, create) {
    if (
      !readEnvironmentScope(environmentId, AuthOrchestrationOperateScope) ||
      !readEnvironmentScope(environmentId, AuthFilesystemWriteScope)
    )
      throw new Error("This connection cannot create writing projects.");
    const normalized = create ? path : (await browse(environmentId, path)).parentPath;
    const existing = readProjects().find(
      (project) => project.environmentId === environmentId && project.workspaceRoot === normalized,
    );
    if (existing) return { environmentId, projectId: existing.id, path: existing.workspaceRoot };
    const projectId = newProjectId();
    value(
      await runAtomCommand(
        appAtomRegistry,
        projectEnvironment.create,
        {
          environmentId,
          input: {
            projectId,
            title: name,
            workspaceRoot: normalized,
            createWorkspaceRootIfMissing: create,
          },
        },
        { label: "Create writing project", reportFailure: false },
      ),
    );
    const project = await waitForProject({ environmentId, projectId });
    return { environmentId, projectId, path: project.workspaceRoot };
  },
};

export interface WritingFolderActions {
  files: WritingFiles;
  environments: readonly { id: EnvironmentId; label: string }[];
  primaryId: EnvironmentId | null;
  browse: typeof browse;
  pickNativeFolder: ((initialPath: string) => Promise<string | null>) | null;
}

export function useWritingFiles(store: WritingStore): WritingFolderActions {
  const { environments, isReady } = useEnvironments();
  const primaryId = usePrimaryEnvironmentId();
  const primary = environments.find((environment) => environment.environmentId === primaryId);
  const [files] = useState(() =>
    createWritingFiles(store, fileApi, {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    }),
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- owns folder hydration, file autosave, and its subscription to the writing store
  useEffect(() => {
    if (isReady) return files.start();
  }, [files, isReady]);
  return {
    files,
    primaryId,
    browse,
    environments: environments.map((environment) => ({
      id: environment.environmentId,
      label: environment.label,
    })),
    pickNativeFolder:
      typeof window !== "undefined" &&
      window.desktopBridge &&
      primary &&
      isDesktopLocalConnectionTarget(primary.entry.target)
        ? (initialPath) =>
            readLocalApi()?.dialogs.pickFolder({ initialPath }) ?? Promise.resolve(null)
        : null,
  };
}
