/* oxlint-disable shadcn/no-unknown-classes -- This feature supplies its own classes in writing.css. */
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type PointerEvent,
} from "react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { randomUUID } from "../lib/utils";
import { useNativeTitlebarHeight } from "../lib/windowControlsOverlay";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "../hooks/useResizableWidth";
import { observeResize } from "../lib/observeResize";
import { Link } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../components/ui/tooltip";
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
  RefreshCw,
  ArrowUpRight,
  Bot,
  ListTodo,
  StickyNote,
} from "lucide-react";
import {
  assistanceSource,
  createWritingStore,
  documentMarkdown,
  newWritingDocument,
  newWritingAnnotation,
  saveWritingAnnotation,
  type WritingAnnotation,
  type WritingPurpose,
  type WritingDocument,
  type WritingStore,
  type WritingWorkspaceState,
} from "./writing.logic";
import {
  HighlightReply,
  ReviewText,
  ReviewNotes,
  TodoPanel,
  type WritingSelection,
} from "./WritingReview";
import "./writing.css";
import { WritingProjectDialog } from "./WritingProjectDialog";
import type { WritingFolderActions } from "./useWritingFiles";
import type { WritingFileStatus } from "./writing.files";
import { WritingEditor, type WritingEditorHandle } from "./WritingEditor";
import { WritingSelectionToolbar } from "./WritingSelectionToolbar";

const EMPTY_FILE_STATUS: Readonly<Record<string, WritingFileStatus>> = {};
const noFileStatus = () => EMPTY_FILE_STATUS;
const noFileSubscription = () => () => {};

export interface WritingAssistant {
  readonly busy: boolean;
  readonly available: boolean;
  readonly label: string;
  readonly error: string | null;
  readonly thread: ScopedThreadRef | null;
  readonly generate: (
    document: WritingDocument,
    store: WritingStore,
    purpose?: WritingPurpose,
  ) => void;
  readonly cancel: () => void;
  readonly controls?: ReactNode;
}

const fonts = {
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  sans: "Inter Variable, Inter, system-ui, sans-serif",
  mono: '"SFMono-Regular", Consolas, monospace',
};

// Review replaces the Designer tab with Notes. Both use the stored "designer" panel.
const rightPaneName = (notes: boolean) => `context, todos, and ${notes ? "notes" : "designer"}`;

// The part of a scroll container that sticky headings leave uncovered.
function visibleArea(container: Element) {
  const { top, bottom } = container.getBoundingClientRect();
  const inset = Number.parseFloat(getComputedStyle(container).scrollPaddingTop) || 24;
  return { inset, top: top + inset, bottom, height: bottom - top - inset };
}

function isVisible(target: Element, container: Element) {
  const box = target.getBoundingClientRect();
  const view = visibleArea(container);
  return box.top >= view.top && Math.min(box.bottom, box.top + view.height) <= view.bottom;
}

function reveal(target: Element, container: Element) {
  const box = target.getBoundingClientRect();
  const view = visibleArea(container);
  container.scrollTo({
    // Center what fits; start long passages at the top.
    top: container.scrollTop + box.top - view.top - Math.max(0, (view.height - box.height) / 2),
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
  });
}

function WritingPane({
  side,
  visible,
  notes = false,
  children,
}: {
  side: "left" | "right";
  visible: boolean;
  notes?: boolean;
  children: ReactNode;
}) {
  const overlay = useMediaQuery("(max-width: 850px)");
  const compact = useMediaQuery("(max-width: 1200px)");
  const [containerWidth, setContainerWidth] = useState(() => window.innerWidth);
  const left = side === "left";
  const defaultWidth = left
    ? compact && !overlay
      ? 205
      : 235
    : overlay
      ? 320
      : compact
        ? 280
        : 310;
  const minWidth = left ? 180 : 240;
  const maxWidth = Math.max(
    minWidth,
    Math.min(560, Math.floor(overlay ? containerWidth - 35 : (containerWidth - 360) / 2)),
  );
  const { width, setWidth, handlers } = useResizableWidth({
    storageKey: `whisk:writing:${side}-pane-width`,
    defaultWidth,
    minWidth,
    maxWidth,
    edge: left ? "right" : "left",
  });

  const tabs = rightPaneName(notes);
  return (
    <aside
      className={left ? "whisk-sidebar" : "whisk-inspector"}
      aria-label={left ? "Projects and files" : `C${tabs.slice(1)}`}
      data-visible={visible}
      data-notes={notes || undefined}
      data-whisk-feature
      style={{ [RESIZABLE_WIDTH_PROPERTY]: `${width}px` } as CSSProperties}
      ref={(host) => {
        const row = host?.parentElement;
        if (!row) return;
        const measure = () => setContainerWidth(row.clientWidth);
        measure();
        return observeResize(row, measure);
      }}
    >
      <div className="whisk-pane-body">{children}</div>
      <div
        className="whisk-pane-resize"
        role="separator"
        aria-label={left ? "Resize projects pane" : `Resize ${tabs} pane`}
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        {...handlers}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          handlers.onPointerDown(event);
        }}
        onDoubleClick={() => setWidth(defaultWidth)}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          let nextWidth: number;
          switch (event.key) {
            case "ArrowLeft":
              nextWidth = width + (left ? -16 : 16);
              break;
            case "ArrowRight":
              nextWidth = width + (left ? 16 : -16);
              break;
            case "Home":
              nextWidth = minWidth;
              break;
            case "End":
              nextWidth = maxWidth;
              break;
            default:
              return;
          }
          event.preventDefault();
          event.stopPropagation();
          setWidth(nextWidth);
        }}
      />
    </aside>
  );
}

function Tool({
  label,
  children,
  active,
  onClick,
  hint,
}: {
  label: string;
  children: ReactNode;
  active?: boolean;
  onClick: () => void;
  hint?: string;
}) {
  const button = (
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
  return hint ? (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipPopup side="bottom">{hint}</TooltipPopup>
    </Tooltip>
  ) : (
    button
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
  folders,
}: {
  assistant: WritingAssistant;
  store?: WritingStore;
  folders?: WritingFolderActions;
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
  const currentProject = workspace.projects.find((item) => item.id === document.projectId)!;
  const fileStatuses = useSyncExternalStore(
    folders?.files.subscribe ?? noFileSubscription,
    folders?.files.getSnapshot ?? noFileStatus,
  );
  const fileStatus = fileStatuses[currentProject.id];
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentSettingsOpen, setAgentSettingsOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectToAttach, setProjectToAttach] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [selection, setSelection] = useState<WritingSelection | null>(null);
  const [highlightDrafts, setHighlightDrafts] = useState<
    ReadonlyArray<{ documentId: string; annotation: WritingAnnotation }>
  >([]);
  const [activeNote, setActiveNote] = useState<{
    id: string;
    scroll: "note" | "text";
    edit?: boolean;
  } | null>(null);
  const [todoDraft, setTodoDraft] = useState({ documentId: "", text: "" });
  const panelBeforeReview = useRef<WritingWorkspaceState["rightPanel"]>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<WritingEditorHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const featureHovered = useRef(false);
  const showChrome = (event?: PointerEvent<HTMLDivElement>) => {
    if (event)
      featureHovered.current =
        event.target instanceof Element &&
        Boolean(event.target.closest("[data-whisk-feature], button, a, select"));
    setChromeVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (workspace.view === "sparse" && !featureHovered.current)
      idleTimer.current = setTimeout(() => setChromeVisible(false), 1_200);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the pointer-idle timer when this workspace unmounts
  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- scrolls to the other half of a selected note after its pane and highlight have rendered
  useEffect(() => {
    if (!activeNote) return;
    const id = CSS.escape(activeNote.id);
    const note = appRef.current?.querySelector(`[data-note="${id}"]`);
    const pane = note?.closest(".whisk-pane-body");
    if (note && pane && (activeNote.scroll === "note" || !isVisible(note, pane)))
      reveal(note, pane);
    if (activeNote.edit) note?.querySelector("textarea")?.focus({ preventScroll: true });
    const passage = appRef.current?.querySelector(`[data-highlights~="${id}"]`);
    const canvas = passage?.closest(".whisk-canvas");
    // Opening the pane reflows the text, so keep a clicked highlight in view too.
    if (passage && canvas && (activeNote.scroll === "text" || !isVisible(passage, canvas)))
      reveal(passage, canvas);
  }, [activeNote]);
  const patch = (values: Partial<WritingDocument>) =>
    store.updateDocument(document.id, (current) => ({ ...current, ...values }));
  const setPanel = (panel: WritingWorkspaceState["rightPanel"]) =>
    store.update((state) => ({ ...state, rightPanel: state.rightPanel === panel ? null : panel }));
  const setView = (view: WritingWorkspaceState["view"]) => {
    setSelection(null);
    if (view === "review" && workspace.view !== "review") {
      panelBeforeReview.current = workspace.rightPanel;
      const openNotes = document.annotations.length > 0 && window.innerWidth > 850;
      store.update((state) => ({
        ...state,
        view,
        rightPanel: openNotes ? "designer" : state.rightPanel,
      }));
    } else {
      // Notes give way to Designer in Designed, and to whatever Sparse had before.
      const closeNotes =
        workspace.view === "review" && view === "sparse" && workspace.rightPanel === "designer";
      store.update((state) => ({
        ...state,
        view,
        rightPanel: closeNotes ? panelBeforeReview.current : state.rightPanel,
      }));
    }
    showChrome();
  };
  const updateDesign = (values: Partial<WritingDocument["design"]>) =>
    store.updateDocument(document.id, (current) => ({
      ...current,
      design: { ...current.design, ...values },
    }));
  const addDocument = (projectId: string) => {
    setSelection(null);
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
  const outlineVisible = workspace.includeOutline;
  const pendingSelection =
    selection?.documentId === document.id && selection.source === document.text ? selection : null;
  const drafts = highlightDrafts
    .filter((draft) => draft.documentId === document.id)
    .map((draft) => draft.annotation);
  // New highlights appear beside the saved ones while their notes are being written.
  const reviewDocument = {
    ...document,
    annotations: [
      ...document.annotations,
      ...drafts.filter((draft) => !document.annotations.some((item) => item.id === draft.id)),
    ],
  };
  const notesOpen = workspace.view === "review" && workspace.rightPanel === "designer";
  const controlsVisible =
    workspace.view !== "sparse" ||
    chromeVisible ||
    settingsOpen ||
    agentSettingsOpen ||
    projectDialogOpen ||
    pendingSelection !== null;
  const openNote = (id: string, edit = false) => {
    setSelection(null);
    if (workspace.view !== "review") setView("review");
    store.update((state) => ({ ...state, rightPanel: "designer" }));
    setActiveNote({ id, scroll: "note", edit });
  };
  const locateHighlight = (annotation: WritingAnnotation) => {
    if (workspace.view !== "review") setView("review");
    setActiveNote({ id: annotation.id, scroll: "text" });
  };
  const putDraft = (annotation: WritingAnnotation) =>
    setHighlightDrafts((current) => [
      ...current.filter((draft) => draft.annotation.id !== annotation.id),
      { documentId: document.id, annotation },
    ]);
  const dropDraft = (annotation: WritingAnnotation) =>
    setHighlightDrafts((current) =>
      current.filter((draft) => draft.annotation.id !== annotation.id),
    );
  const editHighlight = (annotation: WritingAnnotation) => {
    putDraft(annotation);
    openNote(annotation.id, true);
  };
  const agentHighlight = (annotation: WritingAnnotation) =>
    editHighlight({
      ...(drafts.find((draft) => draft.id === annotation.id) ?? annotation),
      destination: "agent",
    });
  const selectHighlight = (
    kind: WritingAnnotation["kind"],
    destination: WritingAnnotation["destination"],
    quick = false,
  ) => {
    if (!pendingSelection) return;
    const annotation = newWritingAnnotation(
      document.text,
      pendingSelection.start,
      pendingSelection.end,
      kind,
      "",
      destination,
    );
    if (quick) {
      store.updateDocument(document.id, (current) => saveWritingAnnotation(current, annotation));
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      setActiveNote({ id: annotation.id, scroll: "note" });
    } else {
      window.getSelection()?.removeAllRanges();
      editHighlight(annotation);
    }
  };
  const saveHighlight = (draft: WritingAnnotation, send: boolean) => {
    const annotationId = draft.id;
    store.updateDocument(document.id, (current) =>
      saveWritingAnnotation(current, {
        ...(current.annotations.find((item) => item.id === annotationId) ?? draft),
        kind: draft.kind,
        note: draft.note.trim(),
        destination: draft.destination,
      }),
    );
    dropDraft(draft);
    setSelection(null);
    if (draft.destination === "todo") store.update((state) => ({ ...state, rightPanel: "todos" }));
    else setActiveNote({ id: annotationId, scroll: "note" });
    if (send) {
      const latest = store
        .getSnapshot()
        .workspace.documents.find((item) => item.id === document.id)!;
      assistant.generate(latest, store, { kind: "highlight", annotationId });
      setAgentSettingsOpen(true);
    }
  };
  const resolveHighlight = (annotation: WritingAnnotation) =>
    store.updateDocument(document.id, (current) => {
      const latest = current.annotations.find((item) => item.id === annotation.id);
      return latest
        ? saveWritingAnnotation(current, { ...latest, resolved: !latest.resolved })
        : current;
    });
  const style = {
    "--whisk-paper": workspace.preferences.paper,
    "--whisk-ink": workspace.preferences.ink,
    "--whisk-font": fonts[workspace.preferences.font],
    "--whisk-size": `${workspace.preferences.fontSize}px`,
    "--whisk-design-font": fonts[document.design.font],
    "--whisk-accent": document.design.accent,
    paddingTop: nativeTitlebarHeight,
  } as CSSProperties;
  const outline = outlineVisible ? (
    <section className="whisk-outline" aria-label="Suggested unwritten passages" data-whisk-feature>
      <div className="whisk-outline-label">
        <ListTree size={13} /> Unwritten passages {stale && <span>· Draft has changed</span>}
      </div>
      {!document.assistance?.outline.length && (
        <div className="whisk-outline-empty">
          <p>{document.assistance ? "No unwritten passages." : "No outline yet."}</p>
          <span>
            {document.assistance
              ? "Refresh the outline in Agent settings when you want more suggestions."
              : "Generate an outline in Agent settings using your writing and context."}
          </span>
          <button type="button" onClick={() => setAgentSettingsOpen(true)}>
            <Bot size={14} /> Open Agent settings
          </button>
        </div>
      )}
      {document.assistance?.outline.map((passage, index) => (
        <div className="whisk-passage" key={passage.heading}>
          <h2>{passage.heading}</h2>
          <p>{passage.body}</p>
          <button
            type="button"
            onClick={() => {
              store.updateDocument(document.id, (current) => ({
                ...current,
                text: [
                  ...current.blocks,
                  { kind: "h2" as const, text: passage.heading },
                  { kind: "paragraph" as const, text: passage.body },
                ]
                  .map((block) => block.text)
                  .join("\n"),
                blocks: [
                  ...current.blocks,
                  { kind: "h2", text: passage.heading },
                  { kind: "paragraph", text: passage.body },
                ],
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
      ref={appRef}
      style={style}
      onPointerMove={showChrome}
      onPointerLeave={() => {
        featureHovered.current = false;
        showChrome();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (settingsOpen || agentSettingsOpen || projectDialogOpen) return;
          if (pendingSelection) {
            setSelection(null);
            return;
          }
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
          data-whisk-feature
        />
      )}
      <a className="whisk-skip" href="#whisk-writing">
        Skip to writing
      </a>
      {workspace.leftOpen && (
        <WritingPane side="left" visible={controlsVisible}>
          <div className="whisk-brand">
            <Feather size={22} strokeWidth={1.5} />
            <strong>Whisk</strong>
            <span>Write something.</span>
          </div>
          <div className="whisk-sidebar-heading">
            <span>PROJECTS</span>
            <Tool
              label="New project"
              onClick={() => {
                setProjectToAttach(null);
                setProjectDialogOpen(true);
              }}
            >
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
                {project.folder ? (
                  <div className="whisk-project-storage">
                    <span className="whisk-folder-path">{project.folder.path}</span>
                    <button
                      type="button"
                      aria-label={`Reload ${project.name} from folder`}
                      onClick={() => {
                        void folders?.files.reload(project.id);
                      }}
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="whisk-project-folder-action"
                    onClick={() => {
                      setProjectToAttach(project.id);
                      setProjectDialogOpen(true);
                    }}
                  >
                    <FolderPlus size={12} /> Save to folder…
                  </button>
                )}
                {workspace.documents
                  .filter((item) => item.projectId === project.id)
                  .map((item) => (
                    <button
                      type="button"
                      className="whisk-file"
                      key={item.id}
                      aria-current={item.id === document.id ? "page" : undefined}
                      onClick={() => {
                        setSelection(null);
                        store.update((state) => ({ ...state, activeDocumentId: item.id }));
                      }}
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
              <span />{" "}
              {workspace.projects.some((project) => project.folder)
                ? "Files with browser recovery"
                : "Saved on this browser"}
            </span>
            <a href="https://github.com/SturmOlling/Whisk" target="_blank" rel="noreferrer">
              An open place to write <ArrowUpRight size={13} />
            </a>
          </div>
        </WritingPane>
      )}

      <main className="whisk-main" id="whisk-writing">
        <header className="whisk-toolbar" data-visible={controlsVisible} data-whisk-feature>
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
                ["designed", "Designed"],
                ["review", "Review"],
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
            <Tool
              label="Shadow outline"
              active={workspace.includeOutline}
              hint={workspace.includeOutline ? "Hide shadow outline" : "Show shadow outline"}
              onClick={() =>
                store.update((state) => ({ ...state, includeOutline: !state.includeOutline }))
              }
            >
              <ListTree size={17} />
            </Tool>
            <Tool
              label="Agent settings"
              active={agentSettingsOpen}
              onClick={() => setAgentSettingsOpen(true)}
            >
              <Bot size={17} />
            </Tool>
            <Tool label="Writing settings" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={17} />
            </Tool>
            <Tool
              label={
                workspace.rightPanel
                  ? `Hide ${rightPaneName(workspace.view === "review")}`
                  : `Show ${rightPaneName(workspace.view === "review")}`
              }
              active={workspace.rightPanel !== null}
              onClick={() => setPanel(workspace.rightPanel ?? "context")}
            >
              <PanelRight size={17} />
            </Tool>
          </div>
        </header>

        {(saveError || importError || fileStatus?.phase === "error") && (
          <div className="whisk-notice" role="alert" data-whisk-feature>
            {saveError ?? importError ?? fileStatus?.message}
            {fileStatus?.phase === "error" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    void folders?.files.flush(currentProject.id);
                  }}
                >
                  Retry file save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void folders?.files.reload(currentProject.id);
                  }}
                >
                  Reload folder, keep recovery copy
                </button>
              </>
            )}
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
            </div>
          )}
          {workspace.view === "review" && (
            <div className="whisk-preview-controls">
              <span>REVIEW</span>
              <span>Select text to highlight, note, or act.</span>
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
            <WritingEditor
              key={document.id}
              ref={editorRef}
              document={document}
              hidden={workspace.view === "review"}
              readOnly={fileStatus?.phase === "loading"}
              onSelect={setSelection}
              onChange={(text, blocks) => {
                patch({ text, blocks });
                if (!featureHovered.current) setChromeVisible(false);
              }}
            />
            {workspace.view === "review" && (
              <ReviewText
                document={reviewDocument}
                activeId={activeNote?.id ?? null}
                onSelect={setSelection}
                onInspect={(annotation) => openNote(annotation.id)}
              />
            )}
            {outline}
          </article>
          {workspace.view === "designed" && (
            <div className="whisk-preview-footnote">
              {document.design.instructions
                ? `Design direction: ${document.design.instructions}`
                : "Shape the page in Designer."}
            </div>
          )}
        </div>

        <footer className="whisk-status" data-visible={controlsVisible} data-whisk-feature>
          <span>
            {words.toLocaleString()} {words === 1 ? "word" : "words"}
            <span className="whisk-status-dot">·</span>
            {saveError
              ? "Export to keep your work"
              : currentProject.folder
                ? (fileStatus?.message ?? "Opening folder…")
                : "Saved in this browser"}
          </span>
          <button
            type="button"
            onClick={() => store.update((state) => ({ ...state, rightPanel: "todos" }))}
          >
            <ListTodo size={14} /> Todos · {document.todos.filter((todo) => !todo.done).length}
          </button>
          {workspace.view === "review" && (
            <button
              type="button"
              onClick={() => store.update((state) => ({ ...state, rightPanel: "designer" }))}
            >
              <StickyNote size={14} /> Notes · {document.annotations.length}
            </button>
          )}
          <button type="button" onClick={() => setPanel("context")}>
            Context <ArrowUpRight size={12} />
          </button>
        </footer>
        {pendingSelection && (
          <WritingSelectionToolbar
            selection={pendingSelection}
            review={workspace.view === "review"}
            onFormat={(kind) => editorRef.current?.format(kind)}
            onHighlight={selectHighlight}
            onDismiss={() => setSelection(null)}
          />
        )}
      </main>

      {workspace.rightPanel && (
        <WritingPane side="right" visible={controlsVisible} notes={workspace.view === "review"}>
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
                aria-pressed={workspace.rightPanel === "todos"}
                onClick={() => setPanel("todos")}
              >
                Todos
              </button>
              <button
                type="button"
                aria-pressed={workspace.rightPanel === "designer"}
                onClick={() => setPanel("designer")}
              >
                {workspace.view === "review" ? "Notes" : "Designer"}
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
              <button
                type="button"
                className="whisk-text-action"
                onClick={() => setAgentSettingsOpen(true)}
              >
                <Bot size={14} /> Outline and questions in Agent settings
              </button>
            </>
          ) : workspace.rightPanel === "todos" ? (
            <TodoPanel
              key={document.id}
              document={document}
              text={todoDraft.documentId === document.id ? todoDraft.text : ""}
              onText={(text) => setTodoDraft({ documentId: document.id, text })}
              onAdd={(text) =>
                store.updateDocument(document.id, (current) => ({
                  ...current,
                  todos: [
                    ...current.todos,
                    { id: randomUUID(), text, done: false, annotationId: null },
                  ],
                }))
              }
              onToggle={(todo) =>
                store.updateDocument(document.id, (current) => ({
                  ...current,
                  todos: current.todos.map((item) =>
                    item.id === todo.id ? { ...item, done: !item.done } : item,
                  ),
                  annotations: current.annotations.map((item) =>
                    item.id === todo.annotationId ? { ...item, resolved: !todo.done } : item,
                  ),
                }))
              }
              onDelete={(todo) =>
                store.updateDocument(document.id, (current) => ({
                  ...current,
                  todos: current.todos.filter((item) => item.id !== todo.id),
                }))
              }
              onInspect={locateHighlight}
              onAgent={agentHighlight}
            />
          ) : notesOpen ? (
            <ReviewNotes
              document={reviewDocument}
              drafts={drafts}
              activeId={activeNote?.id ?? null}
              busy={assistant.busy}
              available={assistant.available}
              error={assistant.error}
              onLocate={locateHighlight}
              onEdit={editHighlight}
              onDraft={putDraft}
              onCancel={dropDraft}
              onSave={saveHighlight}
              onAgent={agentHighlight}
              onResolve={resolveHighlight}
              onSettings={() => setAgentSettingsOpen(true)}
              onTodo={(annotation) => {
                store.updateDocument(document.id, (current) =>
                  saveWritingAnnotation(current, {
                    ...(current.annotations.find((item) => item.id === annotation.id) ??
                      annotation),
                    destination: "todo",
                  }),
                );
                store.update((state) => ({ ...state, rightPanel: "todos" }));
              }}
              onDelete={(annotation) => {
                store.updateDocument(document.id, (current) => ({
                  ...current,
                  annotations: current.annotations.filter((item) => item.id !== annotation.id),
                  todos: current.todos.map((todo) =>
                    todo.annotationId === annotation.id ? { ...todo, annotationId: null } : todo,
                  ),
                }));
                dropDraft(annotation);
              }}
            />
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
              <button
                type="button"
                className="whisk-text-action"
                onClick={() => setAgentSettingsOpen(true)}
              >
                <Bot size={14} /> Apply directions with an agent
              </button>
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
            </>
          )}
        </WritingPane>
      )}

      <Dialog.Root open={agentSettingsOpen} onOpenChange={setAgentSettingsOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="whisk-dialog-backdrop" />
          <Dialog.Popup className="whisk-dialog whisk-agent-settings" data-whisk-feature>
            <div className="whisk-dialog-heading">
              <Dialog.Title>
                <Bot size={20} /> Agent settings
              </Dialog.Title>
              <Dialog.Close aria-label="Close agent settings">
                <X size={18} />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Choose your agent, refresh suggestions, and manage requests. Your writing stays yours.
            </Dialog.Description>
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

            <div className="whisk-card-actions">
              <button
                type="button"
                className="whisk-primary"
                disabled={assistant.busy || !assistant.available}
                onClick={() => {
                  store.update((state) => ({ ...state, includeOutline: true }));
                  assistant.generate(document, store, "outline");
                }}
              >
                Update outline
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
                Apply design directions
              </button>
            </div>
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

            {document.annotations.some((item) => item.reply) && (
              <section className="whisk-agent-results" aria-label="Highlight resolutions">
                <h3>Highlight resolutions</h3>
                {document.annotations
                  .filter((item) => item.reply)
                  .map((annotation) => (
                    <article key={annotation.id} className="whisk-review-card">
                      <blockquote>{annotation.quote}</blockquote>
                      <HighlightReply document={document} annotation={annotation} />
                      <button
                        type="button"
                        className="whisk-text-action"
                        onClick={() => {
                          setAgentSettingsOpen(false);
                          locateHighlight(annotation);
                        }}
                      >
                        See in Review
                      </button>
                    </article>
                  ))}
              </section>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

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
              Writing preferences apply to Sparse and Review. Designed has its own typography.
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
              Drafts are saved in this browser. A backup includes every project, draft, context,
              design setting, highlight, and todo. Import replaces this workspace; export a backup
              first.
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

      {projectDialogOpen && (
        <WritingProjectDialog
          folders={folders}
          project={workspace.projects.find((project) => project.id === projectToAttach) ?? null}
          onClose={() => {
            setProjectDialogOpen(false);
            setProjectToAttach(null);
          }}
        />
      )}
    </div>
  );
}
