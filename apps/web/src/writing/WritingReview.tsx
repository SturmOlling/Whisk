/* oxlint-disable shadcn/no-unknown-classes -- Writing controls use the feature stylesheet. */
import { createElement } from "react";
import { Bot, Check } from "lucide-react";
import {
  findWritingAnchor,
  isHighlightReplyStale,
  type WritingAnnotation,
  type WritingDocument,
  type WritingTodo,
  type WritingBlock,
} from "./writing.logic";

export interface WritingSelection {
  documentId: string;
  source: string;
  start: number;
  end: number;
  format?: WritingBlock["kind"];
  bold?: boolean;
  italic?: boolean;
  anchor?: { contextElement: Element; getBoundingClientRect: () => DOMRect };
}

const highlightKinds = { good: "Good", unclear: "Unclear", comment: "Comment" } as const;

export function HighlightReply({
  document,
  annotation,
}: {
  document: WritingDocument;
  annotation: WritingAnnotation;
}) {
  if (!annotation.reply) return null;
  return (
    <div className="whisk-agent-reply">
      <strong>Agent resolution</strong>
      <p>{annotation.reply.text}</p>
      {isHighlightReplyStale(document, annotation) && (
        <p className="whisk-panel-hint">
          The draft, context, or request has changed since this response.
        </p>
      )}
    </div>
  );
}

export function ReviewText({
  document,
  activeId,
  onSelect,
  onInspect,
}: {
  document: WritingDocument;
  activeId: string | null;
  onSelect: (selection: WritingSelection) => void;
  onInspect: (annotation: WritingAnnotation) => void;
}) {
  const anchors = document.annotations.flatMap((annotation) => {
    const start = findWritingAnchor(document.text, annotation);
    return start === null ? [] : [{ annotation, start, end: start + annotation.quote.length }];
  });
  const boundaries = [
    ...new Set([0, document.text.length, ...anchors.flatMap(({ start, end }) => [start, end])]),
  ].sort((a, b) => a - b);
  const inspectSelection = (host: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (
      !host.contains(range.startContainer) ||
      !host.contains(range.endContainer) ||
      !range.toString().trim()
    )
      return;
    const offsetAt = (node: Node, offset: number) => {
      if (node === host)
        return offset >= host.children.length
          ? document.text.length
          : Number((host.children[offset] as HTMLElement | undefined)?.dataset.writingStart ?? 0);
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
      const block = element?.closest<HTMLElement>("[data-writing-start]");
      if (!block) return 0;
      const prefix = range.cloneRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(node, offset);
      return Number(block.dataset.writingStart) + prefix.toString().length;
    };
    const start = offsetAt(range.startContainer, range.startOffset);
    const end = offsetAt(range.endContainer, range.endOffset);
    const anchoredRange = range.cloneRange();
    onSelect({
      documentId: document.id,
      source: document.text,
      start,
      end,
      anchor: {
        contextElement: host,
        getBoundingClientRect: () =>
          Array.from(anchoredRange.getClientRects()).at(-1) ??
          anchoredRange.getBoundingClientRect(),
      },
    });
  };
  let offset = 0;
  let number = 0;
  const renderedBlocks = document.blocks.map((block, blockIndex) => {
    const blockStart = offset;
    const blockEnd = offset + block.text.length;
    offset = blockEnd + 1;
    number = block.kind === "number" ? (block.numberStart ?? number + 1) : 0;
    const stops = [
      ...new Set([
        blockStart,
        blockEnd,
        ...(block.marks ?? []).flatMap(({ start, end }) => [blockStart + start, blockStart + end]),
        ...boundaries.filter((point) => point > blockStart && point < blockEnd),
      ]),
    ].sort((a, b) => a - b);
    const pieces = stops.slice(0, -1).map((start, index) => {
      const end = stops[index + 1]!;
      // Where highlights overlap, the shortest passage is the one a click means.
      const covering = anchors
        .filter((anchor) => anchor.start <= start && anchor.end >= end)
        .sort((a, b) => a.end - a.start - (b.end - b.start));
      const first =
        covering.find(({ annotation }) => annotation.id === activeId)?.annotation ??
        covering[0]?.annotation;
      const target = covering[0]?.annotation;
      const text = document.text.slice(start, end);
      const mark = block.marks?.find(
        (mark) => blockStart + mark.start <= start && blockStart + mark.end >= end,
      );
      const italic = mark?.italic ? <em>{text}</em> : text;
      const content = mark?.bold ? <strong>{italic}</strong> : italic;
      return first && target ? (
        <mark
          key={start}
          className={`whisk-highlight whisk-highlight-${first.kind}`}
          data-highlights={covering.map(({ annotation }) => annotation.id).join(" ")}
          aria-current={first.id === activeId ? "true" : undefined}
          role="button"
          tabIndex={0}
          aria-label={`${highlightKinds[first.kind]} highlight: ${text}`}
          onClick={() => {
            if (window.getSelection()?.isCollapsed !== false) onInspect(target);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onInspect(target);
            }
          }}
        >
          {content}
        </mark>
      ) : (
        <span key={start}>{content}</span>
      );
    });
    const tag =
      block.kind === "title"
        ? "h1"
        : block.kind === "h1" || block.kind === "h2" || block.kind === "h3"
          ? block.kind
          : block.kind === "quote"
            ? "blockquote"
            : "p";
    return createElement(
      tag,
      {
        key: blockIndex,
        className: `whisk-review-block whisk-block-${block.kind}`,
        "data-writing-start": blockStart,
        ...(block.kind === "number" ? { "data-number": `${number}.` } : {}),
      },
      pieces.length ? pieces : <br />,
    );
  });
  return (
    <div
      className="whisk-review-text"
      aria-label="Review text"
      onPointerUp={(event) => inspectSelection(event.currentTarget)}
      onKeyUp={(event) => inspectSelection(event.currentTarget)}
    >
      {document.text ? (
        renderedBlocks
      ) : (
        <span className="whisk-panel-hint">Your writing will appear here for review.</span>
      )}
    </div>
  );
}

export function ReviewNotes({
  document,
  drafts,
  activeId,
  busy,
  available,
  error,
  onLocate,
  onEdit,
  onDraft,
  onCancel,
  onSave,
  onDelete,
  onTodo,
  onResolve,
  onAgent,
  onSettings,
}: {
  document: WritingDocument;
  drafts: ReadonlyArray<WritingAnnotation>;
  activeId: string | null;
  busy: boolean;
  available: boolean;
  error: string | null;
  onLocate: (annotation: WritingAnnotation) => void;
  onEdit: (annotation: WritingAnnotation) => void;
  onDraft: (annotation: WritingAnnotation) => void;
  onCancel: (annotation: WritingAnnotation) => void;
  onSave: (annotation: WritingAnnotation, send: boolean) => void;
  onDelete: (annotation: WritingAnnotation) => void;
  onTodo: (annotation: WritingAnnotation) => void;
  onResolve: (annotation: WritingAnnotation) => void;
  onAgent: (annotation: WritingAnnotation) => void;
  onSettings: () => void;
}) {
  // Read alongside the text: document order, with lost passages kept at the end.
  const notes = document.annotations
    .map((annotation) => ({ annotation, start: findWritingAnchor(document.text, annotation) }))
    .sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || 0);
  return (
    <section className="whisk-review-notes" aria-label="Highlights and notes">
      <div className="whisk-panel-intro">
        <span className="whisk-eyebrow">IN THE MARGIN</span>
        <h2>Notes on this draft</h2>
        <p>
          {notes.length
            ? "Select a note to find its passage, or a highlight to find its note."
            : "Select a passage to mark it Good or Unclear, add a note, create a todo, or ask your agent."}
        </p>
      </div>
      {notes.map(({ annotation, start }) => {
        const draft = drafts.find((item) => item.id === annotation.id);
        return (
          // The quote button is the keyboard route to the same action.
          <article
            key={annotation.id}
            className="whisk-review-card"
            data-note={annotation.id}
            data-resolved={annotation.resolved}
            data-active={annotation.id === activeId}
            onClick={(event) => {
              if (
                window.getSelection()?.isCollapsed === false ||
                (event.target instanceof Element &&
                  event.target.closest("button, form, .whisk-agent-reply"))
              )
                return;
              onLocate(annotation);
            }}
          >
            <div className="whisk-section-heading">
              <span className={`whisk-mark-kind whisk-highlight-${annotation.kind}`}>
                {highlightKinds[annotation.kind]}
              </span>
              <span>
                {annotation.resolved
                  ? "Resolved"
                  : annotation.destination === "note"
                    ? "Note to self"
                    : annotation.destination === "todo"
                      ? "Todo"
                      : "Agent request"}
              </span>
            </div>
            <button
              type="button"
              className="whisk-note-quote"
              aria-label={`Show in text: ${annotation.quote.slice(0, 80)}`}
              onClick={() => onLocate(annotation)}
            >
              {annotation.quote}
            </button>
            {start === null && (
              <p className="whisk-panel-hint">
                This passage changed or was removed. Your note is preserved.
              </p>
            )}
            {draft ? (
              <HighlightForm
                annotation={draft}
                document={document}
                busy={busy}
                available={available}
                error={error}
                onChange={onDraft}
                onCancel={() => onCancel(draft)}
                onSave={(send) => onSave(draft, send)}
                onDelete={() => onDelete(draft)}
                onSettings={onSettings}
              />
            ) : (
              <>
                {annotation.note && <p className="whisk-note-text">{annotation.note}</p>}
                <HighlightReply document={document} annotation={annotation} />
                <div className="whisk-card-actions">
                  <button type="button" onClick={() => onEdit(annotation)}>
                    Edit note
                  </button>
                  <button type="button" onClick={() => onTodo(annotation)}>
                    Add to todos
                  </button>
                  <button type="button" onClick={() => onAgent(annotation)}>
                    <Bot size={13} /> Resolve with agent
                  </button>
                  <button type="button" onClick={() => onResolve(annotation)}>
                    {annotation.resolved ? (
                      "Reopen"
                    ) : (
                      <>
                        <Check size={13} /> Resolve
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}

export function TodoPanel({
  document,
  text,
  onText,
  onAdd,
  onToggle,
  onDelete,
  onInspect,
  onAgent,
}: {
  document: WritingDocument;
  text: string;
  onText: (text: string) => void;
  onAdd: (text: string) => void;
  onToggle: (todo: WritingTodo) => void;
  onDelete: (todo: WritingTodo) => void;
  onInspect: (annotation: WritingAnnotation) => void;
  onAgent: (annotation: WritingAnnotation) => void;
}) {
  return (
    <>
      <div className="whisk-panel-intro">
        <span className="whisk-eyebrow">ONE THING AT A TIME</span>
        <h2>Todos for this draft</h2>
        <p>Capture a next step, or send a highlighted passage here.</p>
      </div>
      <form
        className="whisk-todo-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!text.trim()) return;
          onAdd(text.trim());
          onText("");
        }}
      >
        <label className="whisk-field">
          <span>New todo</span>
          <input
            value={text}
            maxLength={2_000}
            placeholder="What needs doing?"
            onChange={(event) => onText(event.target.value)}
            required
          />
        </label>
        <button type="submit" className="whisk-primary">
          Add todo
        </button>
      </form>
      <p className="whisk-panel-hint">
        {document.todos.filter((todo) => !todo.done).length} remaining
      </p>
      <ul className="whisk-todos" aria-label="Document todos">
        {document.todos.map((todo) => {
          const annotation = document.annotations.find((item) => item.id === todo.annotationId);
          return (
            <li key={todo.id} data-done={todo.done}>
              <label className="whisk-todo-label">
                <input type="checkbox" checked={todo.done} onChange={() => onToggle(todo)} />
                <span>{todo.text}</span>
              </label>
              {annotation && (
                <>
                  <button
                    type="button"
                    className="whisk-todo-quote"
                    onClick={() => onInspect(annotation)}
                  >
                    “{annotation.quote}”
                  </button>
                  <button
                    type="button"
                    className="whisk-text-action"
                    onClick={() => onAgent(annotation)}
                  >
                    <Bot size={13} /> Resolve with agent
                  </button>
                  <HighlightReply document={document} annotation={annotation} />
                </>
              )}
              <button
                type="button"
                className="whisk-text-action"
                aria-label={`Delete todo: ${todo.text}`}
                onClick={() => onDelete(todo)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function HighlightForm({
  annotation,
  document,
  busy,
  available,
  error,
  onChange,
  onCancel,
  onSave,
  onDelete,
  onSettings,
}: {
  annotation: WritingAnnotation;
  document: WritingDocument;
  busy: boolean;
  available: boolean;
  error: string | null;
  onChange: (annotation: WritingAnnotation) => void;
  onCancel: () => void;
  onSave: (send: boolean) => void;
  onDelete: () => void;
  onSettings: () => void;
}) {
  return (
    <form
      aria-label="About this passage"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(annotation.destination === "agent");
      }}
    >
      <label className="whisk-field">
        <span>Highlight type</span>
        <select
          value={annotation.kind}
          onChange={(event) =>
            onChange({ ...annotation, kind: event.target.value as WritingAnnotation["kind"] })
          }
        >
          {Object.entries(highlightKinds).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="whisk-highlight-destination">
        <legend>Use this highlight as</legend>
        {(
          [
            ["note", "Note to self"],
            ["todo", "Todo"],
            ["agent", "Agent request"],
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name={`highlight-destination-${annotation.id}`}
              value={value}
              checked={annotation.destination === value}
              onChange={() => onChange({ ...annotation, destination: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="whisk-field">
        <span>
          {annotation.destination === "agent"
            ? "Instruction to agent"
            : annotation.destination === "todo"
              ? "What needs doing?"
              : "Note to self"}
        </span>
        <textarea
          value={annotation.note}
          maxLength={2_000}
          placeholder={
            annotation.destination === "agent"
              ? "Explain, improve, or resolve this passage…"
              : "Your thought about this passage…"
          }
          onChange={(event) => onChange({ ...annotation, note: event.target.value })}
        />
      </label>
      <HighlightReply document={document} annotation={annotation} />
      {annotation.destination === "agent" && !available && (
        <p className="whisk-panel-hint">
          Connect your agent to send this request. You can save it for later.
        </p>
      )}
      {error && annotation.destination === "agent" && (
        <p role="alert" className="whisk-error">
          {error}
        </p>
      )}
      <div className="whisk-card-actions">
        <button
          type="submit"
          className="whisk-primary"
          disabled={annotation.destination === "agent" && (busy || !available)}
        >
          {annotation.destination === "agent" ? (
            <>
              <Bot size={14} /> {busy ? "Agent working…" : "Send to agent"}
            </>
          ) : annotation.destination === "todo" ? (
            "Save todo"
          ) : (
            "Save note"
          )}
        </button>
        {annotation.destination === "agent" && (
          <>
            <button type="button" onClick={() => onSave(false)}>
              Save for later
            </button>
            <button
              type="button"
              onClick={() => {
                onSave(false);
                onSettings();
              }}
            >
              Agent settings
            </button>
          </>
        )}
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onDelete}>
          Delete highlight
        </button>
      </div>
    </form>
  );
}
