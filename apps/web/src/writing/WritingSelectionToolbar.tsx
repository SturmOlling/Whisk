/* oxlint-disable shadcn/no-unknown-classes -- Writing controls use the feature stylesheet. */
import { Popover } from "@base-ui/react/popover";
import { Bold, Bot, Italic, List, ListOrdered, Quote, X } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../components/ui/tooltip";
import type { WritingSelection } from "./WritingReview";
import type { WritingAnnotation, WritingBlock } from "./writing.logic";
import { writingFormats } from "./writing.format";

export function WritingSelectionToolbar({
  selection,
  review,
  onFormat,
  onHighlight,
  onDismiss,
}: {
  selection: WritingSelection;
  review: boolean;
  onFormat: (kind: WritingBlock["kind"] | "bold" | "italic") => void;
  onHighlight: (
    kind: WritingAnnotation["kind"],
    destination: WritingAnnotation["destination"],
    quick?: boolean,
  ) => void;
  onDismiss: () => void;
}) {
  if (!selection.anchor) return null;
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) onDismiss();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={selection.anchor}
          positionMethod="fixed"
          side="bottom"
          sideOffset={8}
          align="center"
          collisionPadding={10}
          collisionBoundary={selection.anchor.contextElement.closest(".whisk-canvas") ?? undefined}
          className="whisk-selection-positioner"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            className="whisk-selection-actions"
            role="toolbar"
            aria-label={review ? "Highlight selection" : "Format selection"}
            data-whisk-feature
            onPointerDown={(event) => {
              if (event.target instanceof Element && !event.target.closest("select"))
                event.preventDefault();
            }}
          >
            {review ? (
              <>
                <button type="button" onClick={() => onHighlight("good", "note", true)}>
                  Good
                </button>
                <button type="button" onClick={() => onHighlight("unclear", "note", true)}>
                  Unclear
                </button>
                <button type="button" onClick={() => onHighlight("comment", "note")}>
                  Note
                </button>
                <button type="button" onClick={() => onHighlight("comment", "todo")}>
                  Todo
                </button>
                <button type="button" onClick={() => onHighlight("comment", "agent")}>
                  <Bot size={14} /> Ask agent
                </button>
              </>
            ) : (
              <>
                <select
                  aria-label="Text style"
                  value={
                    selection.format &&
                    ["paragraph", "title", "subtitle", "h1", "h2", "h3"].includes(selection.format)
                      ? selection.format
                      : "paragraph"
                  }
                  onChange={(event) => onFormat(event.target.value as WritingBlock["kind"])}
                >
                  {writingFormats.slice(0, 6).map(([kind, label]) => (
                    <option key={kind} value={kind}>
                      {label}
                    </option>
                  ))}
                </select>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label="Bold"
                    aria-pressed={selection.bold}
                    aria-keyshortcuts="Meta+B Control+B"
                    onClick={() => onFormat("bold")}
                  >
                    <Bold size={16} />
                  </TooltipTrigger>
                  <TooltipPopup>Bold (⌘B / Ctrl+B)</TooltipPopup>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    aria-label="Italic"
                    aria-pressed={selection.italic}
                    aria-keyshortcuts="Meta+I Control+I"
                    onClick={() => onFormat("italic")}
                  >
                    <Italic size={16} />
                  </TooltipTrigger>
                  <TooltipPopup>Italic (⌘I / Ctrl+I)</TooltipPopup>
                </Tooltip>
                <button
                  type="button"
                  aria-label="Bulleted list"
                  aria-pressed={selection.format === "bullet"}
                  onClick={() => onFormat("bullet")}
                >
                  <List size={17} />
                </button>
                <button
                  type="button"
                  aria-label="Numbered list"
                  aria-pressed={selection.format === "number"}
                  onClick={() => onFormat("number")}
                >
                  <ListOrdered size={17} />
                </button>
                <button
                  type="button"
                  aria-label="Quote"
                  aria-pressed={selection.format === "quote"}
                  onClick={() => onFormat("quote")}
                >
                  <Quote size={16} />
                </button>
              </>
            )}
            <button type="button" aria-label="Dismiss selection actions" onClick={onDismiss}>
              <X size={14} />
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
