import type { JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { fromMarkdown } from "mdast-util-from-markdown";
import type { WritingBlock, WritingDocument } from "./writing.logic";

export const writingFormats = [
  ["paragraph", "Body"],
  ["title", "Title"],
  ["subtitle", "Subtitle"],
  ["h1", "H1"],
  ["h2", "H2"],
  ["h3", "H3"],
  ["bullet", "Bullets"],
  ["number", "Numbered"],
  ["quote", "Quote"],
] as const;

function textContent(block: WritingBlock): JSONContent[] {
  let offset = 0;
  const content: JSONContent[] = [];
  const append = (text: string, marks: { type: string }[] = []) => {
    text.split("\n").forEach((line, index) => {
      if (index) content.push({ type: "hardBreak" });
      if (line) content.push({ type: "text", text: line, marks });
    });
  };
  for (const mark of block.marks ?? []) {
    append(block.text.slice(offset, mark.start));
    append(block.text.slice(mark.start, mark.end), [
      ...(mark.bold ? [{ type: "bold" }] : []),
      ...(mark.italic ? [{ type: "italic" }] : []),
    ]);
    offset = mark.end;
  }
  append(block.text.slice(offset));
  return content;
}

export function writingEditorContent(blocks: readonly WritingBlock[]): JSONContent {
  const content: JSONContent[] = [];
  for (const block of blocks) {
    const paragraph = { type: "paragraph", content: textContent(block) };
    if (block.kind === "bullet" || block.kind === "number") {
      const type = block.kind === "bullet" ? "bulletList" : "orderedList";
      let list = content.at(-1);
      if (
        list?.type !== type ||
        (block.kind === "number" &&
          block.numberStart !== undefined &&
          block.numberStart !== Number(list.attrs?.start ?? 1) + (list.content?.length ?? 0))
      ) {
        list = {
          type,
          ...(block.kind === "number" ? { attrs: { start: block.numberStart ?? 1 } } : {}),
          content: [],
        };
        content.push(list);
      }
      list.content!.push({ type: "listItem", content: [paragraph] });
    } else if (block.kind === "quote") {
      content.push({ type: "blockquote", content: [paragraph] });
    } else if (block.kind === "paragraph") content.push(paragraph);
    else
      content.push({
        type: "heading",
        attrs: {
          level: block.kind === "h3" ? 3 : block.kind === "h2" || block.kind === "subtitle" ? 2 : 1,
          writingStyle: block.kind === "title" || block.kind === "subtitle" ? block.kind : null,
        },
        content: textContent(block),
      });
  }
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

export function writingEditorBlocks(doc: ProseMirrorNode): WritingBlock[] {
  const blocks: WritingBlock[] = [];
  const visit = (
    node: ProseMirrorNode,
    inherited: WritingBlock["kind"] = "paragraph",
    numberStart = 1,
  ) => {
    if (node.isTextblock) {
      const kind =
        node.type.name === "heading"
          ? node.attrs.writingStyle === "title" || node.attrs.writingStyle === "subtitle"
            ? node.attrs.writingStyle
            : (`h${node.attrs.level}` as "h1" | "h2" | "h3")
          : inherited;
      const marks: NonNullable<WritingBlock["marks"]>[number][] = [];
      node.forEach((child, start) => {
        if (!child.isText) return;
        const bold = child.marks.some((mark) => mark.type.name === "bold");
        const italic = child.marks.some((mark) => mark.type.name === "italic");
        if (bold || italic) marks.push({ start, end: start + child.nodeSize, bold, italic });
      });
      blocks.push({
        kind,
        text: node.textBetween(0, node.content.size, "", "\n"),
        ...(kind === "number" ? { numberStart } : {}),
        ...(marks.length ? { marks } : {}),
      });
    } else
      node.forEach((child, _offset, index) =>
        visit(
          child,
          node.type.name === "bulletList"
            ? "bullet"
            : node.type.name === "orderedList"
              ? "number"
              : node.type.name === "blockquote"
                ? "quote"
                : inherited,
          node.type.name === "orderedList" ? Number(node.attrs.start ?? 1) + index : numberStart,
        ),
      );
  };
  visit(doc);
  return blocks.length ? blocks : [{ kind: "paragraph", text: "" }];
}

export function writingOffsetAt(doc: ProseMirrorNode, position: number): number {
  if (position <= 0) return 0;
  let offset = 0;
  let result: number | null = null;
  doc.descendants((node, start) => {
    if (!node.isTextblock) return true;
    if (position >= start + 1 && position <= start + node.nodeSize - 1)
      result = offset + node.textBetween(0, Math.max(0, position - start - 1), "", "\n").length;
    offset += node.textBetween(0, node.content.size, "", "\n").length + 1;
    return false;
  });
  return result ?? Math.max(0, offset - 1);
}

export function documentFromMarkdown(markdown: string, document: WritingDocument): WritingDocument {
  const tree = fromMarkdown(markdown);
  const blocks: WritingBlock[] = [];
  let title = document.title;
  const inline = (node: {
    type: string;
    value?: string | undefined;
    children?: readonly { type: string }[] | undefined;
    position?:
      | { start: { offset?: number | undefined }; end: { offset?: number | undefined } }
      | undefined;
  }): string => {
    if (node.type === "break") return "\n";
    if (
      ["strong", "emphasis", "link", "image", "inlineCode", "html"].includes(node.type) &&
      node.position
    )
      return markdown.slice(node.position.start.offset, node.position.end.offset);
    return node.value ?? node.children?.map((child) => inline(child)).join("") ?? "";
  };
  tree.children.forEach((node, index) => {
    if (node.type === "heading") {
      if (index === 0 && node.depth === 1) title = inline(node);
      else
        blocks.push({
          kind: node.depth <= 3 ? (`h${node.depth}` as "h1" | "h2" | "h3") : "h3",
          text: inline(node),
        });
    } else if (node.type === "list") {
      for (const [index, item] of node.children.entries())
        blocks.push({
          kind: node.ordered ? "number" : "bullet",
          text: item.children.map((child) => inline(child)).join("\n"),
          ...(node.ordered ? { numberStart: (node.start ?? 1) + index } : {}),
        });
    } else if (node.type === "blockquote") {
      for (const child of node.children) blocks.push({ kind: "quote", text: inline(child) });
    } else if (node.type === "paragraph") {
      const subtitle =
        node.children.length === 1 && node.children[0]?.type === "emphasis"
          ? node.children[0]
          : null;
      blocks.push({
        kind: subtitle ? "subtitle" : "paragraph",
        text: subtitle ? subtitle.children.map((child) => inline(child)).join("") : inline(node),
      });
    } else if (node.position)
      blocks.push({
        kind: "paragraph",
        text: markdown.slice(node.position.start.offset, node.position.end.offset),
      });
  });
  if (!blocks.length) blocks.push({ kind: "paragraph", text: "" });
  return { ...document, title, blocks, text: blocks.map((block) => block.text).join("\n") };
}
