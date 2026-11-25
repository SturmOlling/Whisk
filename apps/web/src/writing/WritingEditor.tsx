/* oxlint-disable shadcn/no-unknown-classes -- Writing controls use the feature stylesheet. */
import { useImperativeHandle, useLayoutEffect, type Ref } from "react";
import { Extension, type Editor } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Plugin } from "@tiptap/pm/state";
import type { WritingBlock, WritingDocument } from "./writing.logic";
import type { WritingSelection } from "./WritingReview";
import { writingEditorBlocks, writingEditorContent, writingOffsetAt } from "./writing.format";

const WritingStyles = Extension.create({
  name: "writingStyles",
  addProseMirrorPlugins: () => [
    new Plugin({
      filterTransaction: (transaction) =>
        writingEditorBlocks(transaction.doc)
          .map((block) => block.text)
          .join("\n").length <= 200_000,
    }),
  ],
  addGlobalAttributes: () => [
    {
      types: ["heading"],
      attributes: {
        writingStyle: {
          default: null,
          keepOnSplit: false,
          parseHTML: (element) => element.getAttribute("data-writing-style"),
          renderHTML: (attributes) =>
            attributes.writingStyle ? { "data-writing-style": attributes.writingStyle } : {},
        },
      },
    },
  ],
});
const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    underline: false,
    strike: false,
    code: false,
    codeBlock: false,
    horizontalRule: false,
    link: false,
    trailingNode: false,
  }),
  WritingStyles,
];

export interface WritingEditorHandle {
  focus: () => void;
  format: (kind: WritingBlock["kind"] | "bold" | "italic") => void;
}

function selectionFor(editor: Editor, documentId: string): WritingSelection | null {
  const { from, to, empty } = editor.state.selection;
  if (empty) return null;
  const blocks = writingEditorBlocks(editor.state.doc);
  const source = blocks.map((block) => block.text).join("\n");
  const start = writingOffsetAt(editor.state.doc, from);
  const end = writingOffsetAt(editor.state.doc, to);
  if (!source.slice(start, end).trim()) return null;
  const style = editor.isActive("heading")
    ? (editor.getAttributes("heading").writingStyle ?? `h${editor.getAttributes("heading").level}`)
    : editor.isActive("bulletList")
      ? "bullet"
      : editor.isActive("orderedList")
        ? "number"
        : editor.isActive("blockquote")
          ? "quote"
          : "paragraph";
  return {
    documentId,
    source,
    start,
    end,
    format: style as WritingBlock["kind"],
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    anchor: {
      contextElement: editor.view.dom,
      getBoundingClientRect: () => {
        const { from: currentFrom, to: currentTo } = editor.state.selection;
        const begin = editor.view.coordsAtPos(currentFrom);
        const finish = editor.view.coordsAtPos(currentTo);
        const sameLine = Math.abs(begin.top - finish.top) < 2;
        return new DOMRect(
          sameLine ? Math.min(begin.left, finish.left) : finish.left,
          finish.top,
          sameLine ? Math.abs(finish.left - begin.left) : 0,
          finish.bottom - finish.top,
        );
      },
    },
  };
}

export function WritingEditor({
  document,
  hidden,
  readOnly = false,
  onChange,
  onSelect,
  ref,
}: {
  document: WritingDocument;
  hidden: boolean;
  readOnly?: boolean;
  onChange: (text: string, blocks: readonly WritingBlock[]) => void;
  onSelect: (selection: WritingSelection | null) => void;
  ref: Ref<WritingEditorHandle>;
}) {
  const editor = useEditor({
    extensions,
    content: writingEditorContent(document.blocks),
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "whisk-editor",
        role: "textbox",
        "aria-label": "Your writing",
        "aria-multiline": "true",
        "data-placeholder": "Begin anywhere…",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: active }) => {
      const blocks = writingEditorBlocks(active.state.doc);
      onChange(blocks.map((block) => block.text).join("\n"), blocks);
      onSelect(selectionFor(active, document.id));
    },
    onSelectionUpdate: ({ editor: active }) => onSelect(selectionFor(active, document.id)),
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- synchronizes externally loaded drafts and accepted outline passages into the controlled editor, without replacing its view on mode changes
  useLayoutEffect(() => {
    if (
      editor &&
      JSON.stringify(writingEditorBlocks(editor.state.doc)) !== JSON.stringify(document.blocks)
    )
      editor.commands.setContent(writingEditorContent(document.blocks), { emitUpdate: false });
    editor?.setEditable(!readOnly, false);
  }, [editor, document.blocks, readOnly]);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor?.commands.focus();
      },
      format: (kind) => {
        if (!editor) return;
        const chain = editor.chain().focus();
        if (kind === "bold") chain.toggleBold().run();
        else if (kind === "italic") chain.toggleItalic().run();
        else if (kind === "bullet") {
          if (editor.isActive("bulletList")) chain.toggleBulletList().run();
          else chain.clearNodes().setParagraph().toggleBulletList().run();
        } else if (kind === "number") {
          if (editor.isActive("orderedList")) chain.toggleOrderedList().run();
          else chain.clearNodes().setParagraph().toggleOrderedList().run();
        } else if (kind === "quote") {
          if (editor.isActive("blockquote")) chain.toggleBlockquote().run();
          else chain.clearNodes().setParagraph().toggleBlockquote().run();
        } else if (kind === "paragraph") chain.clearNodes().setParagraph().run();
        else
          chain
            .clearNodes()
            .setHeading({ level: kind === "h3" ? 3 : kind === "h2" || kind === "subtitle" ? 2 : 1 })
            .updateAttributes("heading", {
              writingStyle: kind === "title" || kind === "subtitle" ? kind : null,
            })
            .run();
      },
    }),
    [editor],
  );
  return <EditorContent editor={editor} className="whisk-editor-host" hidden={hidden} />;
}
