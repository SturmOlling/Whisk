/* oxlint-disable shadcn/no-unknown-classes -- Writing controls use the feature stylesheet. */
import { useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Folder, ArrowUp, X } from "lucide-react";
import type { FilesystemBrowseEntry } from "@t3tools/contracts";
import type { WritingProject } from "./writing.logic";
import type { WritingFolderActions } from "./useWritingFiles";

export function WritingProjectDialog({
  folders,
  project,
  onClose,
}: {
  folders?: WritingFolderActions | undefined;
  project: WritingProject | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? "");
  const [environmentId, setEnvironmentId] = useState(
    folders?.primaryId ?? folders?.environments[0]?.id ?? null,
  );
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<readonly FilesystemBrowseEntry[]>([]);
  const [browsing, setBrowsing] = useState(false);
  const [create, setCreate] = useState(project === null);
  const [folderName, setFolderName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const browse = async (target: string) => {
    if (!folders || !environmentId) return;
    const token = ++generation.current;
    setBusy(true);
    setError(null);
    try {
      const result = await folders.browse(environmentId, target);
      if (token !== generation.current) return;
      setPath(result.parentPath);
      setEntries(result.entries);
      setBrowsing(true);
    } catch (cause) {
      if (token === generation.current)
        setError(cause instanceof Error ? cause.message : "Could not browse this folder.");
    }
    if (token === generation.current) setBusy(false);
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="whisk-dialog-backdrop" />
        <Dialog.Popup className="whisk-dialog whisk-project-dialog" data-whisk-feature>
          <div className="whisk-dialog-heading">
            <Dialog.Title>
              {project ? "Save this project to a folder" : "A home for an idea."}
            </Dialog.Title>
            <Dialog.Close aria-label="Close project folder" disabled={busy}>
              <X size={18} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            {project
              ? "Copy this project's drafts, notes, and todos to a folder. Your browser copy stays available for recovery."
              : "Open an existing writing folder or create a new one. Documents are saved as Markdown with their notes and settings alongside them."}
          </Dialog.Description>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (!folders || !environmentId || busy || !name.trim() || !path.trim()) return;
              const childName = (folderName || name).trim();
              if (
                create &&
                (!childName || childName === "." || childName === ".." || /[/\\\0]/.test(childName))
              ) {
                setError("Choose a folder name without slashes.");
                return;
              }
              setBusy(true);
              setError(null);
              try {
                await folders.files.open({
                  environmentId,
                  name: name.trim(),
                  path: create ? `${path.replace(/[/\\]+$/, "")}/${childName}` : path.trim(),
                  create,
                  ...(project ? { existingProjectId: project.id } : {}),
                });
                onClose();
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Could not open this project folder.",
                );
              }
              setBusy(false);
            }}
          >
            <label className="whisk-field">
              <span>Project name</span>
              <input
                value={name}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                required
                disabled={busy}
              />
            </label>
            {folders && folders.environments.length > 1 && (
              <label className="whisk-field">
                <span>Machine</span>
                <select
                  value={environmentId ?? ""}
                  disabled={busy}
                  onChange={(event) => {
                    setEnvironmentId(
                      folders.environments.find((item) => item.id === event.target.value)?.id ??
                        null,
                    );
                    setEntries([]);
                    setBrowsing(false);
                    setPath("~/");
                  }}
                >
                  {folders.environments.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="whisk-field">
              <span>Folder location</span>
              <input
                value={path}
                placeholder="Choose a folder or enter a path"
                onChange={(event) => {
                  setPath(event.target.value);
                  setBrowsing(false);
                }}
                required
                disabled={busy}
              />
            </label>
            <div className="whisk-card-actions">
              <button
                type="button"
                className="whisk-primary"
                onClick={() => {
                  void browse(path || "~/");
                }}
                disabled={busy || !environmentId}
              >
                Browse folders
              </button>
              {folders?.pickNativeFolder && environmentId === folders.primaryId && (
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await folders.pickNativeFolder!(path || "~/");
                    if (picked) await browse(picked);
                  }}
                >
                  Choose in Finder…
                </button>
              )}
            </div>
            {browsing && (
              <div className="whisk-folder-browser" aria-label="Folder browser">
                <button
                  type="button"
                  className="whisk-text-action"
                  onClick={() => {
                    void browse(`${path.replace(/[/\\]+$/, "")}/../`);
                  }}
                  disabled={busy}
                >
                  <ArrowUp size={14} /> Parent folder
                </button>
                <p className="whisk-folder-current">{path}</p>
                <ul>
                  {entries.map((entry) => (
                    <li key={entry.fullPath}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          void browse(entry.fullPath);
                        }}
                      >
                        <Folder size={15} /> {entry.name}
                      </button>
                    </li>
                  ))}
                </ul>
                {!entries.length && (
                  <p className="whisk-panel-hint">
                    No subfolders. You can use this folder or create one here.
                  </p>
                )}
              </div>
            )}
            <label className="whisk-create-folder">
              <input
                type="checkbox"
                checked={create}
                onChange={(event) => setCreate(event.target.checked)}
                disabled={busy}
              />
              Create a new folder here
            </label>
            {create && (
              <label className="whisk-field">
                <span>New folder name</span>
                <input
                  value={folderName}
                  placeholder={name || "My writing"}
                  onChange={(event) => setFolderName(event.target.value)}
                  maxLength={200}
                  disabled={busy}
                />
              </label>
            )}
            {(!folders || !environmentId) && (
              <p role="alert" className="whisk-error">
                Connect a writable environment to choose a project folder. Your existing writing
                stays available.
              </p>
            )}
            {error && (
              <p role="alert" className="whisk-error">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="whisk-primary whisk-project-submit"
              disabled={busy || !folders || !environmentId}
            >
              {busy ? "Opening folder…" : project ? "Save project to folder" : "Create project"}
            </button>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
