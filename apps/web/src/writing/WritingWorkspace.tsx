/* oxlint-disable shadcn/no-unknown-classes -- This feature supplies its own classes in writing.css. */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { randomUUID } from "../lib/utils";
import { useNativeTitlebarHeight } from "../lib/windowControlsOverlay";
import { Link } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  FileText,
  FolderPlus,
  PanelLeft,
  PanelRight,
  Plus,
  Settings2,
  ListTree,
  X,
  Feather,
  Check,
  ArrowUpRight,
} from "lucide-react";
import {
  assistanceSource,
  createWritingStore,
  documentMarkdown,
  newWritingDocument,
  type WritingDocument,
  type WritingStore,
  type WritingWorkspaceState,
} from "./writing.logic";
import "./writing.css";

export interface WritingAssistant {
  readonly busy: boolean;
  readonly available: boolean;
  readonly label: string;
  readonly error: string | null;
  readonly thread: ScopedThreadRef | null;
  readonly generate: (
    document: WritingDocument,
    store: WritingStore,
    purpose?: "outline" | "design",
  ) => void;
  readonly cancel: () => void;
  readonly controls?: ReactNode;
}

const fonts = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: "Inter Variable, Inter, system-ui, sans-serif",
  mono: '"SFMono-Regular", Consolas, monospace',
};

function Tool({
  label,
  children,
  active,
  onClick,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="whisk-tool"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function download(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function WritingWorkspace({
  assistant,
  store: suppliedStore,
}: {
  assistant: WritingAssistant;
  store?: WritingStore;
}) {
  const nativeTitlebarHeight = useNativeTitlebarHeight();
  const [store] = useState(
    () =>
      suppliedStore ??
      createWritingStore({
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      }),
  );
  const { workspace, error: saveError } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const document = workspace.documents.find((item) => item.id === workspace.activeDocumentId)!;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showChrome = () => {
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setChromeVisible(false), 2_400);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the pointer-idle timer when this workspace unmounts
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );
  const patch = (values: Partial<WritingDocument>) =>
    store.updateDocument(document.id, (current) => ({ ...current, ...values }));
  const setPanel = (panel: WritingWorkspaceState["rightPanel"]) =>
    store.update((state) => ({ ...state, rightPanel: state.rightPanel === panel ? null : panel }));
  const setView = (view: WritingWorkspaceState["view"]) => {
    store.update((state) => ({ ...state, view }));
    showChrome();
  };
  const updateDesign = (values: Partial<WritingDocument["design"]>) =>
    store.updateDocument(document.id, (current) => ({
      ...current,
      design: { ...current.design, ...values },
    }));
  const addDocument = (projectId: string) => {
    const next = newWritingDocument(projectId);
    store.update((state) => ({
      ...state,
      documents: [...state.documents, next],
      activeDocumentId: next.id,
    }));
  };
  const words = document.text.trim() ? document.text.trim().split(/\s+/u).length : 0;
  const stale =
    document.assistance !== null && document.assistance.source !== assistanceSource(document);
  const outlineVisible =
    workspace.view === "outline" || (workspace.view === "designed" && workspace.includeOutline);
  const style = {
    "--whisk-paper": workspace.preferences.paper,
    "--whisk-ink": workspace.preferences.ink,
    "--whisk-font": fonts[workspace.preferences.font],
    "--whisk-size": `${workspace.preferences.fontSize}px`,
    "--whisk-design-font": fonts[document.design.font],
    "--whisk-accent": document.design.accent,
    paddingTop: nativeTitlebarHeight,
  } as CSSProperties;
  const outline =
    outlineVisible && document.assistance ? (
      <section className="whisk-outline" aria-label="Suggested unwritten passages">
        <div className="whisk-outline-label">
          <ListTree size={13} /> Unwritten passages {stale && <span>· Draft has changed</span>}
        </div>
        {document.assistance.outline.map((passage, index) => (
          <div className="whisk-passage" key={passage.heading}>
            <h2>{passage.heading}</h2>
            <p>{passage.body}</p>
            <button
              type="button"
              onClick={() => {
                store.updateDocument(document.id, (current) => ({
                  ...current,
                  text: [current.text.trimEnd(), `## ${passage.heading}\n\n${passage.body}`]
                    .filter(Boolean)
                    .join("\n\n"),
                  assistance: current.assistance && {
                    ...current.assistance,
                    outline: current.assistance.outline.filter(
                      (_, passageIndex) => passageIndex !== index,
                    ),
                  },
                }));
              }}
            >
              Use passage <ArrowUpRight size={12} />
            </button>
          </div>
        ))}
      </section>
    ) : null;

  return (
    <div
      className="whisk-app"
      style={style}
      onPointerMove={showChrome}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          store.update((state) => ({ ...state, rightPanel: null, leftOpen: false }));
          editorRef.current?.focus();
        }
      }}
    >
      {nativeTitlebarHeight > 0 && (
        <div
          className="whisk-native-titlebar"
          style={{ height: nativeTitlebarHeight }}
          aria-hidden="true"
        />
      )}
      <a className="whisk-skip" href="#whisk-writing">
        Skip to writing
      </a>
      {workspace.leftOpen && (
        <aside className="whisk-sidebar" aria-label="Projects and files">
          <div className="whisk-brand">
            <Feather size={22} strokeWidth={1.5} />
            <strong>Whisk</strong>
            <span>Write something.</span>
          </div>
          <div className="whisk-sidebar-heading">
            <span>PROJECTS</span>
            <Tool label="New project" onClick={() => setProjectDialogOpen(true)}>
              <FolderPlus size={16} />
            </Tool>
          </div>
          <nav aria-label="Writing projects">
            {workspace.projects.map((project) => (
              <details className="whisk-project" key={project.id} open>
                <summary>
                  <ChevronDown size={14} />
                  <span>{project.name}</span>
                </summary>
                {workspace.documents
                  .filter((item) => item.projectId === project.id)
                  .map((item) => (
                    <button
                      type="button"
                      className="whisk-file"
                      key={item.id}
                      aria-current={item.id === document.id ? "page" : undefined}
                      onClick={() =>
                        store.update((state) => ({ ...state, activeDocumentId: item.id }))
                      }
                    >
                      <FileText size={15} />
                      <span>{item.title || "Untitled"}</span>
                    </button>
                  ))}
                <button
                  type="button"
                  className="whisk-new-file"
                  onClick={() => addDocument(project.id)}
                >
                  <Plus size={14} /> New document
                </button>
              </details>
            ))}
          </nav>
          <div className="whisk-sidebar-bottom">
            <span className="whisk-local">
              <span /> Saved on this browser
            </span>
            <a href="https://github.com/SturmOlling/Whisk" target="_blank" rel="noreferrer">
              An open place to write <ArrowUpRight size={13} />
            </a>
          </div>
        </aside>
      )}

      <main className="whisk-main" id="whisk-writing">
        <header className="whisk-toolbar" data-visible={chromeVisible}>
          <div className="whisk-toolbar-start">
            <Tool
              label={workspace.leftOpen ? "Hide projects" : "Show projects"}
              active={workspace.leftOpen}
              onClick={() => store.update((state) => ({ ...state, leftOpen: !state.leftOpen }))}
            >
              <PanelLeft size={17} />
            </Tool>
            <span className="whisk-breadcrumb">
              {workspace.projects.find((item) => item.id === document.projectId)?.name}
              <span>/</span>
              {document.title || "Untitled"}
            </span>
          </div>
          <div className="whisk-views" role="group" aria-label="Writing view">
            {(
              [
                ["sparse", "Sparse"],
                ["outline", "Shadow outline"],
                ["designed", "Designed"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={workspace.view === value}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="whisk-toolbar-end">
            <Tool label="Writing settings" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={17} />
            </Tool>
            <Tool
              label={
                workspace.rightPanel ? "Hide context and designer" : "Show context and designer"
              }
              active={workspace.rightPanel !== null}
              onClick={() => setPanel(workspace.rightPanel ?? "context")}
            >
              <PanelRight size={17} />
            </Tool>
          </div>
        </header>

        {(saveError || importError) && (
          <div className="whisk-notice" role="alert">
            {saveError ?? importError}
            <button
              type="button"
              onClick={() =>
                download(
                  JSON.stringify(workspace, null, 2),
                  "whisk-backup.json",
                  "application/json",
                )
              }
            >
              Export backup
            </button>
          </div>
        )}
        <div
          className={`whisk-canvas ${workspace.view === "designed" ? `whisk-designed whisk-layout-${document.design.layout}` : ""}`}
        >
          {workspace.view === "designed" && (
            <div className="whisk-preview-controls">
              <span>DESIGNED PREVIEW</span>
              <label>
                <input
                  type="checkbox"
                  checked={workspace.includeOutline}
                  onChange={(event) =>
                    store.update((state) => ({ ...state, includeOutline: event.target.checked }))
                  }
                />{" "}
                Include outline
              </label>
            </div>
          )}
          <article className="whisk-page">
            {workspace.view === "designed" && (
              <div className="whisk-design-kicker">
                {document.design.destination || "A work in progress"}
              </div>
            )}
            <input
              className="whisk-title"
              aria-label="Document title"
              placeholder="Untitled"
              maxLength={200}
              value={document.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
            {workspace.view === "designed" && document.design.audience && (
              <p className="whisk-audience">For {document.design.audience}</p>
            )}
            <textarea
              key="writing"
              ref={editorRef}
              className="whisk-editor"
              aria-label="Your writing"
              placeholder="Begin anywhere…"
              spellCheck
              maxLength={100_000}
              value={document.text}
              onChange={(event) => {
                patch({ text: event.target.value });
                setChromeVisible(false);
              }}
            />
            {outline}
            {outlineVisible && !document.assistance && (
              <div className="whisk-outline-empty">
                <ListTree size={18} />
                <p>A little room for what comes next.</p>
                <span>Add your intent in Context, then update the outline.</span>
                <button type="button" onClick={() => setPanel("context")}>
                  Open context <ArrowUpRight size={13} />
                </button>
              </div>
            )}
          </article>
          {workspace.view === "designed" && (
            <div className="whisk-preview-footnote">
              {document.design.instructions
                ? `Design direction: ${document.design.instructions}`
                : "Shape the page in Designer."}
            </div>
          )}
        </div>

        <footer className="whisk-status" data-visible={chromeVisible}>
          <span>
            {words.toLocaleString()} {words === 1 ? "word" : "words"}
            <span className="whisk-status-dot">·</span>
            {saveError ? "Export to keep your work" : "Saved locally"}
          </span>
          <button
            type="button"
            className="whisk-assistant-action"
            disabled={assistant.busy || !assistant.available}
            onClick={() => {
              store.update((state) => ({ ...state, rightPanel: "context" }));
              assistant.generate(document, store);
            }}
          >
            <ListTree size={14} />
            {assistant.busy ? "Thinking…" : "Update outline"}
          </button>
          <button type="button" onClick={() => setPanel("context")}>
            Context <ArrowUpRight size={12} />
          </button>
        </footer>
      </main>

      {workspace.rightPanel && (
        <aside className="whisk-inspector" aria-label="Context and designer">
          <div className="whisk-inspector-heading">
            <div role="group" aria-label="Right pane">
              <button
                type="button"
                aria-pressed={workspace.rightPanel === "context"}
                onClick={() => setPanel("context")}
              >
                Context
              </button>
              <button
                type="button"
                aria-pressed={workspace.rightPanel === "designer"}
                onClick={() => setPanel("designer")}
              >
                Designer
              </button>
            </div>
            <Tool
              label="Close right pane"
              onClick={() => store.update((state) => ({ ...state, rightPanel: null }))}
            >
              <X size={16} />
            </Tool>
          </div>
          {workspace.rightPanel === "context" ? (
            <>
              <div className="whisk-panel-intro">
                <span className="whisk-eyebrow">A SENSE OF DIRECTION</span>
                <h2>What’s on your mind?</h2>
                <p>A little context gives your writing somewhere to go.</p>
              </div>
              <label className="whisk-field">
                <span>Your intent</span>
                <textarea
                  placeholder="I am trying to…"
                  maxLength={100_000}
                  value={document.context}
                  onChange={(event) => patch({ context: event.target.value })}
                />
              </label>
              <div className="whisk-question-heading">
                <ListTree size={14} />
                <h3>Questions to think with</h3>
              </div>
              {document.assistance?.questions.length ? (
                document.assistance.questions.map((question) => (
                  <label className="whisk-field whisk-question" key={question}>
                    <span>{question}</span>
                    <textarea
                      placeholder="Only if it helps…"
                      maxLength={2_000}
                      value={document.answers[question] ?? ""}
                      onChange={(event) =>
                        store.updateDocument(document.id, (current) => ({
                          ...current,
                          answers: { ...current.answers, [question]: event.target.value },
                        }))
                      }
                    />
                  </label>
                ))
              ) : (
                <p className="whisk-panel-hint">
                  Your assistant will offer a few optional questions when you update the outline.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="whisk-panel-intro">
                <span className="whisk-eyebrow">WORDS, WITH A FORM</span>
                <h2>Make it feel right.</h2>
                <p>Think about the person on the other side of the page.</p>
              </div>
              <label className="whisk-field">
                <span>Who is this for?</span>
                <input
                  placeholder="A person, a community, yourself…"
                  value={document.design.audience}
                  maxLength={2_000}
                  onChange={(event) => updateDesign({ audience: event.target.value })}
                />
              </label>
              <label className="whisk-field">
                <span>Where is this for?</span>
                <input
                  placeholder="A journal, a letter, the web…"
                  value={document.design.destination}
                  maxLength={2_000}
                  onChange={(event) => updateDesign({ destination: event.target.value })}
                />
              </label>
              <label className="whisk-field">
                <span>Design directions</span>
                <textarea
                  placeholder="Quiet and editorial. Plenty of space…"
                  value={document.design.instructions}
                  maxLength={2_000}
                  onChange={(event) => updateDesign({ instructions: event.target.value })}
                />
              </label>
              <label className="whisk-field">
                <span>Page layout</span>
                <select
                  value={document.design.layout}
                  onChange={(event) =>
                    updateDesign({
                      layout: event.target.value as WritingDocument["design"]["layout"],
                    })
                  }
                >
                  <option value="editorial">Editorial</option>
                  <option value="letter">Letter</option>
                  <option value="note">Note</option>
                </select>
              </label>
              <label className="whisk-field">
                <span>Typography</span>
                <select
                  value={document.design.font}
                  onChange={(event) =>
                    updateDesign({ font: event.target.value as WritingDocument["design"]["font"] })
                  }
                >
                  <option value="serif">Serif</option>
                  <option value="sans">Sans serif</option>
                  <option value="mono">Monospace</option>
                </select>
              </label>
              <label className="whisk-field whisk-color">
                <span>Accent color</span>
                <input
                  type="color"
                  value={document.design.accent}
                  onChange={(event) => updateDesign({ accent: event.target.value })}
                />
              </label>
              <button type="button" className="whisk-primary" onClick={() => setView("designed")}>
                See designed view <ArrowUpRight size={14} />
              </button>
              <button
                type="button"
                className="whisk-primary"
                disabled={assistant.busy || !assistant.available}
                onClick={() => {
                  setView("designed");
                  assistant.generate(document, store, "design");
                }}
              >
                Apply design directions <ArrowUpRight size={14} />
              </button>
            </>
          )}
          <div className="whisk-assistant-info">
            {assistant.controls}
            <p>{assistant.label}</p>
            {stale && <p>Your draft or context has changed. Refresh when you’re ready.</p>}
            {assistant.error && (
              <p role="alert" className="whisk-error">
                {assistant.error}
              </p>
            )}
            {assistant.busy && (
              <button type="button" onClick={assistant.cancel}>
                Stop generation
              </button>
            )}
            {assistant.thread && (
              <Link to="/$environmentId/$threadId" params={assistant.thread}>
                Open assistant thread <ArrowUpRight size={12} />
              </Link>
            )}
            <Link to="/agents">
              Agent workspace <ArrowUpRight size={12} />
            </Link>
            <Link to="/settings/providers">
              Provider settings <ArrowUpRight size={12} />
            </Link>
          </div>
        </aside>
      )}

      <Dialog.Root open={settingsOpen} onOpenChange={setSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="whisk-dialog-backdrop" />
          <Dialog.Popup className="whisk-dialog">
            <div className="whisk-dialog-heading">
              <Dialog.Title>Make room for your words.</Dialog.Title>
              <Dialog.Close aria-label="Close settings">
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Writing preferences apply to Sparse and Shadow outline. Designer has its own
              typography.
            </Dialog.Description>
            <label className="whisk-field">
              <span>Writing font</span>
              <select
                value={workspace.preferences.font}
                onChange={(event) =>
                  store.update((state) => ({
                    ...state,
                    preferences: {
                      ...state.preferences,
                      font: event.target.value as WritingWorkspaceState["preferences"]["font"],
                    },
                  }))
                }
              >
                <option value="serif">Serif</option>
                <option value="sans">Sans serif</option>
                <option value="mono">Monospace</option>
              </select>
            </label>
            <label className="whisk-field">
              <span>Text size · {workspace.preferences.fontSize}px</span>
              <input
                type="range"
                min="16"
                max="32"
                value={workspace.preferences.fontSize}
                onChange={(event) =>
                  store.update((state) => ({
                    ...state,
                    preferences: { ...state.preferences, fontSize: Number(event.target.value) },
                  }))
                }
              />
            </label>
            {(
              [
                ["paper", "Paper color"],
                ["ink", "Text color"],
              ] as const
            ).map(([key, label]) => (
              <label className="whisk-field whisk-color" key={key}>
                <span>{label}</span>
                <input
                  type="color"
                  value={workspace.preferences[key]}
                  onChange={(event) =>
                    store.update((state) => ({
                      ...state,
                      preferences: { ...state.preferences, [key]: event.target.value },
                    }))
                  }
                />
              </label>
            ))}
            <div className="whisk-export-actions">
              <button
                type="button"
                onClick={() =>
                  download(
                    documentMarkdown(document),
                    `${(document.title || "Untitled").replace(/[^a-z0-9 -]/gi, "").slice(0, 80) || "Untitled"}.md`,
                    "text/markdown",
                  )
                }
              >
                <ArrowDownToLine size={15} /> Export document
              </button>
              <button
                type="button"
                onClick={() =>
                  download(
                    JSON.stringify(workspace, null, 2),
                    "whisk-backup.json",
                    "application/json",
                  )
                }
              >
                <ArrowDownToLine size={15} /> Back up workspace
              </button>
              <button type="button" onClick={() => importRef.current?.click()}>
                <ArrowUpFromLine size={15} /> Import workspace…
              </button>
            </div>
            <p className="whisk-panel-hint">
              Drafts are saved in this browser. A backup includes every project, draft, context, and
              design setting. Import replaces this workspace; export a backup first.
            </p>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                if (file.size > 10_000_000) {
                  setImportError(
                    "This backup is too large to import. Your workspace has not changed.",
                  );
                  event.target.value = "";
                  return;
                }
                try {
                  store.importBackup(await file.text());
                  setImportError(null);
                  setSettingsOpen(false);
                } catch {
                  setImportError(
                    "That file is not a valid Whisk backup. Your workspace has not changed.",
                  );
                }
                event.target.value = "";
              }}
            />
            {importError && (
              <p className="whisk-error" role="alert">
                {importError}
              </p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="whisk-dialog-backdrop" />
          <Dialog.Popup className="whisk-dialog">
            <div className="whisk-dialog-heading">
              <Dialog.Title>A home for an idea.</Dialog.Title>
              <Dialog.Close aria-label="Close new project">
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description>Group related documents in a project.</Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!projectName.trim()) return;
                const project = { id: randomUUID(), name: projectName.trim() };
                const next = newWritingDocument(project.id);
                store.update((state) => ({
                  ...state,
                  projects: [...state.projects, project],
                  documents: [...state.documents, next],
                  activeDocumentId: next.id,
                }));
                setProjectName("");
                setProjectDialogOpen(false);
              }}
            >
              <label className="whisk-field">
                <span>Project name</span>
                <input
                  value={projectName}
                  maxLength={200}
                  onChange={(event) => setProjectName(event.target.value)}
                  required
                />
              </label>
              <button type="submit" className="whisk-primary">
                <Check size={14} /> Create project
              </button>
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
