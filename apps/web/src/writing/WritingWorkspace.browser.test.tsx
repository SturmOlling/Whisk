import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, fakeTimers, render, stubGlobal } from "../../test/render";
import { WritingWorkspace, type WritingAssistant } from "./WritingWorkspace";
import {
  applyHighlightReply,
  assistanceSource,
  createWritingStore,
  documentMarkdown,
  newWritingAnnotation,
} from "./writing.logic";
import { createWritingFiles, type WritingFileApi } from "./writing.files";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type { WritingFolderActions } from "./useWritingFiles";

function folderActions(
  store: ReturnType<typeof createWritingStore>,
  storage: Pick<Storage, "getItem" | "setItem">,
) {
  const disk = new Map<string, string>();
  const environmentId = EnvironmentId.make("browser-writing-environment");
  const ensure = vi.fn<WritingFileApi["ensure"]>(async (_environmentId, path) => ({
    environmentId,
    path,
    projectId: ProjectId.make("browser-writing-folder"),
  }));
  const api: WritingFileApi = {
    ensure,
    list: async () => [],
    read: async (_folder, path) => disk.get(path) ?? null,
    write: async (_folder, path, contents, expected) => {
      if ((disk.get(path) ?? null) !== expected) throw new Error("Changed");
      disk.set(path, contents);
    },
  };
  const folders: WritingFolderActions = {
    files: createWritingFiles(store, api, storage),
    primaryId: environmentId,
    environments: [{ id: environmentId, label: "This Mac" }],
    browse: async () => ({
      parentPath: "/writing",
      entries: [{ name: "Documents", fullPath: "/writing/Documents" }],
    }),
    pickNativeFolder: null,
  };
  return { folders, disk, ensure };
}

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const store = createWritingStore(storage);
  const assistant: WritingAssistant = {
    busy: false,
    available: false,
    label: "Connect an agent to get outlines and optional questions.",
    error: null,
    thread: null,
    generate: () => {},
    cancel: () => {},
  };
  return { store, storage, assistant };
}

it("turns a selection into a private note, a linked todo, and a direct agent request without changing the draft", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  const generate = vi.fn<WritingAssistant["generate"]>();
  await using screen = await render(
    <WritingWorkspace store={store} assistant={{ ...assistant, available: true, generate }} />,
  );
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await editor.fill("An opening worth thinking about.");
  const editorElement = editor.element();
  await screen.getByRole("button", { name: "Review", exact: true }).click();
  const review = screen.container.querySelector<HTMLElement>(".whisk-review-text")!;
  await act(() => {
    const range = window.document.createRange();
    range.selectNodeContents(review.querySelector("span")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    review.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  const actions = page.getByRole("toolbar", { name: "Highlight selection" });
  await actions.getByRole("button", { name: "Note", exact: true }).click();
  const dialog = screen.getByRole("form", { name: "About this passage" });
  await expect.element(dialog.getByRole("textbox", { name: "Note to self" })).toHaveFocus();
  await dialog
    .getByRole("textbox", { name: "Note to self" })
    .fill("Make the opening more concrete.");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  const document = store.getSnapshot().workspace.documents[0]!;
  expect(document.annotations[0]!.quote).toBe(document.text);
  expect(document.annotations[0]!.destination).toBe("note");
  expect(generate).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Review", exact: true }).click();
  expect(screen.container.querySelector(".whisk-editor")).toBe(editorElement);
  await expect
    .element(
      screen.getByRole("button", { name: "Comment highlight: An opening worth thinking about." }),
    )
    .toBeVisible();
  await screen.getByRole("button", { name: "Add to todos", exact: true }).click();
  const todo = screen.getByRole("checkbox", { name: "Make the opening more concrete." });
  await expect.element(todo).not.toBeChecked();
  await todo.click();
  expect(store.getSnapshot().workspace.documents[0]!.annotations[0]!.resolved).toBe(true);
  await screen
    .getByRole("complementary", { name: "Context, todos, and notes" })
    .getByRole("button", { name: "Resolve with agent" })
    .click();
  await dialog
    .getByRole("textbox", { name: "Instruction to agent" })
    .fill("Suggest a clearer opening.");
  await dialog.getByRole("button", { name: "Send to agent", exact: true }).click();
  const latest = store.getSnapshot().workspace.documents[0]!;
  expect(generate).toHaveBeenCalledExactlyOnceWith(latest, store, {
    kind: "highlight",
    annotationId: latest.annotations[0]!.id,
  });
  expect(latest.text).toBe(document.text);
  await expect.element(page.getByRole("dialog", { name: "Agent settings" })).toBeVisible();
  await act(() =>
    store.updateDocument(latest.id, (current) =>
      applyHighlightReply(
        current,
        latest,
        latest.annotations[0]!.id,
        '{"reply":"Open with a concrete example."}',
      ),
    ),
  );
  await expect
    .element(
      page
        .getByRole("region", { name: "Highlight resolutions" })
        .getByText("Open with a concrete example."),
    )
    .toBeVisible();
  await page.getByRole("button", { name: "Close agent settings" }).click();
  await expect.element(screen.getByText("Open with a concrete example.").first()).toBeVisible();
  const restored = createWritingStore(storage).getSnapshot().workspace.documents[0]!;
  expect(restored.annotations[0]!.reply!.text).toBe("Open with a concrete example.");
  expect(restored.todos[0]!.done).toBe(true);
  expect(restored.text).toBe(document.text);
});

it("selects and marks Review text like the thesis reader, keeping Good and Unclear marks and editable comments", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  store.updateDocument(store.getSnapshot().workspace.activeDocumentId, (document) => ({
    ...document,
    text: "A good line. A confusing line.",
  }));
  store.update((state) => ({ ...state, view: "review" }));
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const text = screen.container.querySelector<HTMLElement>(".whisk-review-text")!;
  await screen.getByRole("button", { name: "Hide projects", exact: true }).click();
  // Select real rendered text; dispatch the pointer release that finishes a reader selection.
  await act(() => {
    const range = document.createRange();
    range.setStart(text.querySelector("span")!.firstChild!, 0);
    range.setEnd(text.querySelector("span")!.firstChild!, 12);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    text.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
  });
  const selectionToolbar = page.getByRole("toolbar", { name: "Highlight selection" });
  const selectedBounds = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
  await expect
    .poll(() =>
      Math.abs(selectionToolbar.element().getBoundingClientRect().top - selectedBounds.bottom),
    )
    .toBeLessThan(30);
  await page.viewport(390, 844);
  await expect
    .poll(() => selectionToolbar.element().getBoundingClientRect().right)
    .toBeLessThanOrEqual(390);
  await expect
    .poll(() => selectionToolbar.element().getBoundingClientRect().left)
    .toBeGreaterThanOrEqual(0);
  await page.viewport(1440, 900);
  await page
    .getByRole("toolbar", { name: "Highlight selection" })
    .getByRole("button", { name: "Good", exact: true })
    .click();
  const mark = screen.getByRole("button", { name: "Good highlight: A good line." });
  await expect.element(mark).toBeVisible();
  await mark.click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Edit note", exact: true }).click();
  const dialog = screen.getByRole("form", { name: "About this passage" });
  await dialog.getByRole("combobox", { name: "Highlight type" }).selectOptions("unclear");
  await dialog.getByRole("textbox", { name: "Note to self" }).fill("Check this claim.");
  await dialog.getByRole("button", { name: "Save note", exact: true }).click();
  await expect
    .element(screen.getByRole("button", { name: "Unclear highlight: A good line." }))
    .toBeVisible();
  expect(store.getSnapshot().workspace.documents[0]!.annotations[0]!.note).toBe(
    "Check this claim.",
  );
});

it("swaps Designer for Notes in Review and scrolls between highlights and their notes", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  const text = Array.from(
    { length: 60 },
    (_, index) => `Passage ${index} ${"has words to read. ".repeat(6)}`,
  ).join("\n");
  const quotes = Array.from({ length: 12 }, (_, index) => `Passage ${index * 5} `);
  store.updateDocument(store.getSnapshot().workspace.activeDocumentId, (document) => ({
    ...document,
    text,
    annotations: quotes
      .map((quote, index) => {
        const start = text.indexOf(quote);
        return newWritingAnnotation(
          text,
          start,
          start + quote.length,
          "comment",
          `Note ${index}`,
          "note",
        );
      })
      .reverse(),
  }));
  store.update((state) => ({ ...state, rightPanel: null }));
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const inView = (element: Element, container: Element) => {
    const box = element.getBoundingClientRect();
    const view = container.getBoundingClientRect();
    return box.top >= view.top && box.bottom <= view.bottom;
  };
  const panel = screen.getByRole("group", { name: "Right pane", exact: true });
  await screen.getByRole("button", { name: "Review", exact: true }).click();
  await expect
    .element(panel.getByRole("button", { name: "Notes", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect
    .element(panel.getByRole("button", { name: "Designer", exact: true }))
    .not.toBeInTheDocument();

  const canvas = screen.container.querySelector(".whisk-canvas")!;
  const pane = screen.container.querySelector(".whisk-inspector .whisk-pane-body")!;
  const cards = Array.from(screen.container.querySelectorAll("[data-note]"));
  expect(cards.map((card) => card.querySelector(".whisk-note-text")!.textContent)).toEqual(
    quotes.map((_, index) => `Note ${index}`),
  );
  const marks = Array.from(screen.container.querySelectorAll<HTMLElement>(".whisk-highlight"));

  // A note shows its passage in the text.
  expect(inView(marks[8]!, canvas)).toBe(false);
  cards[8]!.scrollIntoView();
  await page.elementLocator(cards[8]!.querySelector(".whisk-note-text")!).click();
  await expect.poll(() => inView(marks[8]!, canvas)).toBe(true);
  await expect.element(page.elementLocator(marks[8]!)).toHaveAttribute("aria-current", "true");

  // A highlight shows its note, without a dialog over the text or losing unfinished words.
  await page
    .elementLocator(cards[8]!)
    .getByRole("button", { name: "Edit note", exact: true })
    .click();
  const note = page.elementLocator(cards[8]!).getByRole("textbox", { name: "Note to self" });
  await note.fill("Half a thought");
  canvas.scrollTo(0, 0);
  await page.elementLocator(marks[0]!).click();
  await expect.poll(() => inView(cards[0]!, pane)).toBe(true);
  await expect.element(page.elementLocator(cards[0]!)).toHaveAttribute("data-active", "true");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await panel.getByRole("button", { name: "Todos", exact: true }).click();
  await panel.getByRole("button", { name: "Notes", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Note to self" }))
    .toHaveValue("Half a thought");

  // From another tab, a highlight brings Notes back.
  await panel.getByRole("button", { name: "Context", exact: true }).click();
  await page.elementLocator(marks[0]!).click();
  await expect
    .element(panel.getByRole("button", { name: "Notes", exact: true }))
    .toHaveAttribute("aria-pressed", "true");

  await screen.getByRole("button", { name: "Designed", exact: true }).click();
  await expect
    .element(panel.getByRole("button", { name: "Designer", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await screen.getByRole("button", { name: "Review", exact: true }).click();
  await expect.element(panel.getByRole("button", { name: "Notes", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Close right pane", exact: true }).click();

  // On a phone the note sits below its passage.
  await page.viewport(390, 844);
  await screen.getByRole("button", { name: "Hide projects", exact: true }).click();
  await page
    .elementLocator(screen.container.querySelectorAll<HTMLElement>(".whisk-highlight")[0]!)
    .click();
  const inspector = screen.container.querySelector(".whisk-inspector")!;
  await expect
    .poll(
      () =>
        inView(screen.container.querySelector(".whisk-highlight")!, canvas) &&
        canvas.getBoundingClientRect().bottom <= inspector.getBoundingClientRect().top,
    )
    .toBe(true);
});

it("restores a quiet Sparse page after reading notes in Review", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  store.updateDocument(store.getSnapshot().workspace.activeDocumentId, (document) => ({
    ...document,
    text: "A line.",
    annotations: [newWritingAnnotation("A line.", 0, 7, "good", "", "note")],
  }));
  store.update((state) => ({ ...state, rightPanel: null }));
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  await screen.getByRole("button", { name: "Review", exact: true }).click();
  await expect.element(screen.getByRole("region", { name: "Highlights and notes" })).toBeVisible();
  await screen.getByRole("button", { name: "Sparse", exact: true }).click();
  expect(store.getSnapshot().workspace.rightPanel).toBe(null);
});

it("formats selected text beside the selection and preserves headings and lists across views and reload", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await editor.fill("The opening");
  await userEvent.keyboard(
    navigator.platform.toLowerCase().includes("mac") ? "{Meta>}a{/Meta}" : "{Control>}a{/Control}",
  );
  const toolbar = page.getByRole("toolbar", { name: "Format selection" });
  await expect.element(toolbar).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Ask agent", exact: true }))
    .not.toBeInTheDocument();
  const selected = window.getSelection()!.getRangeAt(0).getBoundingClientRect();
  await expect
    .poll(() => {
      const bounds = toolbar.element().getBoundingClientRect();
      return Math.min(
        Math.abs(bounds.top - selected.bottom),
        Math.abs(bounds.bottom - selected.top),
      );
    })
    .toBeLessThan(30);
  for (const [value, kind] of [
    ["title", "title"],
    ["subtitle", "subtitle"],
    ["h1", "h1"],
    ["h2", "h2"],
    ["h3", "h3"],
  ] as const) {
    await toolbar.getByRole("combobox", { name: "Text style" }).selectOptions(value);
    expect(store.getSnapshot().workspace.documents[0]!.blocks[0]!.kind).toBe(kind);
  }
  await toolbar.getByRole("button", { name: "Bulleted list", exact: true }).click();
  expect(store.getSnapshot().workspace.documents[0]!.blocks[0]!.kind).toBe("bullet");
  await toolbar.getByRole("button", { name: "Numbered list", exact: true }).click();
  expect(store.getSnapshot().workspace.documents[0]!.blocks[0]!.kind).toBe("number");
  await toolbar.getByRole("button", { name: "Quote", exact: true }).click();
  expect(store.getSnapshot().workspace.documents[0]!.blocks[0]!.kind).toBe("quote");
  await toolbar.getByRole("combobox", { name: "Text style" }).selectOptions("h2");
  const originalEditor = editor.element();
  await screen.getByRole("button", { name: "Review", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "The opening", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Designed", exact: true }).click();
  expect(editor.element()).toBe(originalEditor);
  await expect
    .element(screen.getByRole("heading", { name: "The opening", exact: true }))
    .toBeVisible();
  await screen.unmount();
  const restored = createWritingStore(storage);
  await using next = await render(<WritingWorkspace store={restored} assistant={assistant} />);
  await expect
    .element(next.getByRole("heading", { name: "The opening", exact: true }))
    .toBeVisible();
});

it("applies bold and italic to selected text through buttons and shortcuts and restores both marks", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  const mod = navigator.platform.toLowerCase().includes("mac") ? "Meta" : "Control";
  const shortcut = (key: string) => userEvent.keyboard(`{${mod}>}${key}{/${mod}}`);
  await editor.fill("A quiet opening");
  await shortcut("a");
  const toolbar = page.getByRole("toolbar", { name: "Format selection" });
  await toolbar.getByRole("button", { name: "Bold", exact: true }).click();
  await expect
    .element(toolbar.getByRole("button", { name: "Bold", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await shortcut("i");
  await expect
    .element(toolbar.getByRole("button", { name: "Italic", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await shortcut("b");
  await expect
    .element(toolbar.getByRole("button", { name: "Bold", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await toolbar.getByRole("button", { name: "Italic", exact: true }).click();
  await expect
    .element(toolbar.getByRole("button", { name: "Italic", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await shortcut("b");
  await shortcut("i");
  const restored = createWritingStore(storage);
  const document = restored.getSnapshot().workspace.documents[0]!;
  expect(document.text).toBe("A quiet opening");
  expect(documentMarkdown(document)).toContain("***A quiet opening***");
  await screen.unmount();
  await using next = await render(<WritingWorkspace store={restored} assistant={assistant} />);
  await expect
    .poll(
      () =>
        next.container.querySelector(".whisk-editor strong em, .whisk-editor em strong")
          ?.textContent,
    )
    .toBe("A quiet opening");
  await next.getByRole("button", { name: "Review", exact: true }).click();
  await expect
    .poll(() => next.container.querySelector(".whisk-review-text strong em")?.textContent)
    .toBe("A quiet opening");
});

it("keeps AI controls in agent settings and adds independent document todos", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  const generate = vi.fn<WritingAssistant["generate"]>();
  await using screen = await render(
    <WritingWorkspace store={store} assistant={{ ...assistant, available: true, generate }} />,
  );
  await screen.getByRole("button", { name: "Context", exact: true }).click();
  await screen
    .getByRole("textbox", { name: "Your intent" })
    .fill("Explain this to first-time readers.");
  await expect
    .element(screen.getByRole("button", { name: "Update outline", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Todos", exact: true }).click();
  await screen.getByRole("textbox", { name: "New todo" }).fill("Check the conclusion");
  await screen.getByRole("button", { name: "Add todo", exact: true }).click();
  await expect
    .element(screen.getByRole("checkbox", { name: "Check the conclusion" }))
    .not.toBeChecked();
  const panel = screen.getByRole("group", { name: "Right pane", exact: true });
  await panel.getByRole("button", { name: "Context", exact: true }).click();
  await screen.getByRole("button", { name: "Outline and questions in Agent settings" }).click();
  const settings = page.getByRole("dialog", { name: "Agent settings" });
  await settings.getByRole("button", { name: "Update outline", exact: true }).click();
  expect(generate).toHaveBeenCalledExactlyOnceWith(
    store.getSnapshot().workspace.documents[0]!,
    store,
    "outline",
  );
  await page.getByRole("button", { name: "Close agent settings" }).click();
  await panel.getByRole("button", { name: "Designer", exact: true }).click();
  await screen
    .getByRole("textbox", { name: "Design directions", exact: true })
    .fill("Make it a personal letter.");
  await screen.getByRole("button", { name: "Apply directions with an agent", exact: true }).click();
  await settings.getByRole("button", { name: "Apply design directions", exact: true }).click();
  expect(generate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      context: "Explain this to first-time readers.",
      design: expect.objectContaining({ instructions: "Make it a personal letter." }),
    }),
    store,
    "design",
  );
  expect(store.getSnapshot().workspace.view).toBe("designed");
  await page.getByRole("button", { name: "Close agent settings" }).click();
  await screen.getByRole("button", { name: "New document", exact: true }).click();
  await expect
    .element(screen.getByRole("checkbox", { name: "Check the conclusion" }))
    .not.toBeInTheDocument();
});

it("resizes both panes independently, restores widths, and keeps saved wide panes within a smaller window", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  using _storage = stubGlobal("localStorage", storage);
  store.update((state) => ({ ...state, rightPanel: "context" }));
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await editor.fill("Keep these words while resizing.");
  const element = editor.element();
  const left = screen.getByRole("complementary", { name: "Projects and files" });
  const right = screen.getByRole("complementary", { name: "Context, todos, and designer" });

  for (const [label, delta] of [
    ["Resize projects pane", 80],
    ["Resize context, todos, and designer pane", -90],
  ] as const) {
    const handle = screen.getByRole("separator", { name: label }).element();
    // Synthetic drag events have no active browser pointer to capture.
    using _capture = vi.spyOn(handle, "setPointerCapture").mockImplementation(() => {});
    const pointer = { bubbles: true, pointerId: 1, button: 0 };
    await act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: 500 }));
      handle.dispatchEvent(new PointerEvent("pointermove", { ...pointer, clientX: 500 + delta }));
      handle.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: 500 + delta }));
    });
  }

  await expect.element(left).toHaveStyle({ width: "315px" });
  await expect.element(right).toHaveStyle({ width: "400px" });
  expect(editor.element()).toBe(element);
  await expect.element(editor).toHaveTextContent("Keep these words while resizing.");
  await screen.getByRole("button", { name: "Hide projects", exact: true }).click();
  await screen.getByRole("button", { name: "Show projects", exact: true }).click();
  await expect.element(left).toHaveStyle({ width: "315px" });
  await screen.unmount();

  await using restored = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const restoredLeft = restored.getByRole("complementary", { name: "Projects and files" });
  const restoredRight = restored.getByRole("complementary", {
    name: "Context, todos, and designer",
  });
  await expect.element(restoredLeft).toHaveStyle({ width: "315px" });
  await expect.element(restoredRight).toHaveStyle({ width: "400px" });
  await page.viewport(900, 800);
  await expect.element(restoredLeft).toHaveStyle({ width: "270px" });
  await expect.element(restoredRight).toHaveStyle({ width: "270px" });
  const toolbar = restored.container.querySelector(".whisk-toolbar")!;
  expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
  await page.viewport(390, 844);
  await expect.element(restoredRight).toHaveStyle({ width: "355px" });
  expect(restored.container.querySelector(".whisk-app")!.scrollWidth).toBeLessThanOrEqual(390);
  await page.viewport(1440, 900);
  await expect.element(restoredLeft).toHaveStyle({ width: "315px" });
  await expect.element(restoredRight).toHaveStyle({ width: "400px" });

  await restored.getByRole("separator", { name: "Resize projects pane" }).click();
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(restoredLeft).toHaveStyle({ width: "331px" });
  await restored
    .getByRole("separator", { name: "Resize context, todos, and designer pane" })
    .click();
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(restoredRight).toHaveStyle({ width: "416px" });
  await userEvent.keyboard("{Home}");
  await expect.element(restoredRight).toHaveStyle({ width: "240px" });
  await restored.getByRole("separator", { name: "Resize projects pane" }).dblClick();
  await expect.element(restoredLeft).toHaveStyle({ width: "235px" });
});

it("fades only over the Sparse writing page and keeps every feature area visible while reading", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  store.update((state) => ({ ...state, rightPanel: "context" }));
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  using _timers = fakeTimers();
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await editor.click();
  const bounds = editor.element().getBoundingClientRect().toJSON();
  const chrome = [
    screen.getByRole("complementary", { name: "Projects and files" }),
    screen.getByRole("complementary", { name: /^Context, todos, and/ }),
    page.elementLocator(screen.container.querySelector(".whisk-toolbar")!),
    // Its text differs between views, so follow the element itself.
    screen.container.querySelector<HTMLElement>(".whisk-status")!,
  ];
  for (const feature of chrome) {
    await userEvent.hover(feature);
    await act(() => vi.advanceTimersByTime(5_000));
    for (const control of chrome) {
      await expect.element(control).toHaveAttribute("data-visible", "true");
      await expect.element(control).toHaveStyle({ opacity: "1" });
    }
  }
  await userEvent.hover(editor);
  await act(() => vi.advanceTimersByTime(1_200));
  for (const control of chrome) {
    await expect.element(control).toHaveStyle({ opacity: "0", transitionDuration: "0.175s" });
  }
  expect(editor.element().getBoundingClientRect().toJSON()).toEqual(bounds);
  for (const view of ["Designed", "Review"] as const) {
    await screen.getByRole("button", { name: view, exact: true }).click();
    await userEvent.hover(page.elementLocator(screen.container.querySelector(".whisk-canvas")!));
    await act(() => vi.advanceTimersByTime(5_000));
    for (const control of chrome) {
      await expect.element(control).toHaveAttribute("data-visible", "true");
      await expect.element(control).toHaveStyle({ opacity: "1" });
    }
  }
});

it("preserves writing and the editor across view changes, edits context/design, and restores the saved session", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await expect.poll(() => editor.element().textContent).toBe("");
  const element = editor.element();
  await editor.fill("The first sentence belongs to me.");
  await screen.getByRole("textbox", { name: "Document title" }).fill("A beginning");
  const shadow = screen.getByRole("button", { name: "Shadow outline", exact: true });
  await shadow.click();
  await expect.element(shadow).toHaveAttribute("aria-pressed", "false");
  await expect
    .element(screen.getByRole("button", { name: "Sparse", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await shadow.click();
  await expect.element(editor).toHaveTextContent("The first sentence belongs to me.");
  expect(editor.element()).toBe(element);
  await screen.getByRole("button", { name: "Context", exact: true }).click();
  await screen
    .getByRole("textbox", { name: "Your intent" })
    .fill("I am trying to explain a new idea.");
  await screen.getByRole("button", { name: "Designer", exact: true }).click();
  await screen.getByRole("textbox", { name: "Who is this for?" }).fill("curious readers");
  await screen.getByRole("textbox", { name: "Where is this for?" }).fill("A journal");
  await screen.getByRole("combobox", { name: "Page layout" }).selectOptions("note");
  await screen.getByRole("button", { name: "See designed view" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Shadow outline", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await expect.element(screen.getByText("For curious readers")).toBeVisible();
  await expect.element(editor).toHaveTextContent("The first sentence belongs to me.");
  expect(editor.element()).toBe(element);
  await screen.getByRole("button", { name: "Close right pane" }).click();
  await screen.getByRole("button", { name: "Hide projects" }).click();
  await expect
    .element(screen.getByRole("complementary", { name: "Projects and files" }))
    .not.toBeInTheDocument();
  await screen.unmount();
  const restored = createWritingStore(storage);
  await using next = await render(<WritingWorkspace store={restored} assistant={assistant} />);
  await expect
    .element(next.getByRole("textbox", { name: "Your writing" }))
    .toHaveTextContent("The first sentence belongs to me.");
  expect(restored.getSnapshot().workspace.documents[0]!.context).toBe(
    "I am trying to explain a new idea.",
  );
  expect(restored.getSnapshot().workspace.documents[0]!.design.layout).toBe("note");
});

it("shows outline toggle feedback before generation in every view without starting an agent turn", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  const generate = vi.fn<WritingAssistant["generate"]>();
  await using screen = await render(
    <WritingWorkspace store={store} assistant={{ ...assistant, generate }} />,
  );
  const toggle = screen.getByRole("button", { name: "Shadow outline", exact: true });
  const outline = screen.getByRole("region", { name: "Suggested unwritten passages" });
  for (const view of ["Sparse", "Designed", "Review"]) {
    await screen.getByRole("button", { name: view, exact: true }).click();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.element(screen.getByText("No outline yet.", { exact: true })).toBeVisible();
    await toggle.click();
    await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.element(outline).not.toBeInTheDocument();
    expect(createWritingStore(storage).getSnapshot().workspace.includeOutline).toBe(false);
    await toggle.click();
    await expect.element(outline).toBeVisible();
  }
  await screen.getByRole("button", { name: "Open Agent settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Agent settings" });
  await expect.element(settings).toBeVisible();
  await expect
    .element(settings.getByRole("button", { name: "Update outline", exact: true }))
    .toBeDisabled();
  expect(generate).not.toHaveBeenCalled();
  expect(store.getSnapshot().workspace.documents[0]!.text).toBe("");
  await page.getByRole("button", { name: "Close agent settings" }).click();
  await act(() =>
    store.updateDocument(store.getSnapshot().workspace.activeDocumentId, (document) => ({
      ...document,
      assistance: {
        outline: [],
        questions: [],
        source: assistanceSource(document),
        generatedAt: "2026-11-17T00:00:00.000Z",
      },
    })),
  );
  await expect.element(screen.getByText("No unwritten passages.", { exact: true })).toBeVisible();
  await toggle.click();
  await expect.element(outline).not.toBeInTheDocument();
});

it("keeps suggestions out of authored text until accepted and switches between independent files", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  const original = store.getSnapshot().workspace.documents[0]!;
  store.updateDocument(original.id, (document) => ({
    ...document,
    text: "My opening.",
    assistance: {
      outline: [{ heading: "What comes next", body: "Explore an unexpected consequence." }],
      questions: ["What should the reader take away?"],
      source: assistanceSource(document),
      generatedAt: "2026-11-17T00:00:00.000Z",
    },
  }));
  store.update((state) => ({ ...state, view: "designed" }));
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await expect.element(screen.getByRole("heading", { name: "What comes next" })).toBeVisible();
  await expect.element(editor).toHaveTextContent("My opening.");
  await screen.getByRole("button", { name: "Shadow outline", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "What comes next" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Shadow outline", exact: true }).click();
  await screen.getByRole("button", { name: "Sparse", exact: true }).click();
  await screen.getByRole("button", { name: "Use passage" }).click();
  expect(
    store.getSnapshot().workspace.documents.find((document) => document.id === original.id)!.text,
  ).toBe("My opening.\nWhat comes next\nExplore an unexpected consequence.");
  await expect
    .element(screen.getByRole("heading", { name: "What comes next", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "New document" }).click();
  await expect.poll(() => editor.element().textContent).toBe("");
  const files = screen.getByRole("navigation", { name: "Writing projects" });
  await files.getByRole("button", { name: "Untitled", exact: true }).first().click();
  expect(
    store.getSnapshot().workspace.documents.find((document) => document.id === original.id)!.text,
  ).toBe("My opening.\nWhat comes next\nExplore an unexpected consequence.");
  await expect
    .element(screen.getByRole("heading", { name: "What comes next", exact: true }))
    .toBeVisible();
});

it("creates a project using a focus-contained dialog and supports keyboard dismissal", async () => {
  await page.viewport(1440, 900);
  const { store, assistant, storage } = setup();
  const { folders, disk, ensure } = folderActions(store, storage);
  await using screen = await render(
    <WritingWorkspace store={store} assistant={assistant} folders={folders} />,
  );
  await screen.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A home for an idea." });
  await dialog.getByRole("textbox", { name: "Project name" }).fill("Essays");
  await dialog.getByRole("button", { name: "Browse folders" }).click();
  await expect
    .element(dialog.getByRole("textbox", { name: "Folder location" }))
    .toHaveValue("/writing");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect
    .poll(() => screen.getByRole("textbox", { name: "Your writing" }).element().textContent)
    .toBe("");
  expect(store.getSnapshot().workspace.projects.map((project) => project.name)).toEqual([
    "My writing",
    "Essays",
  ]);
  expect(ensure).toHaveBeenCalledWith(folders.primaryId, "/writing/Essays", "Essays", true);
  expect(disk.has(".whisk/project.json")).toBe(true);
  await screen.getByRole("button", { name: "Writing settings" }).click();
  await expect
    .element(page.getByRole("dialog", { name: "Make room for your words." }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect
    .element(page.getByRole("dialog", { name: "Make room for your words." }))
    .not.toBeInTheDocument();
});

it("keeps writing and pane controls usable on a phone-sized screen", async () => {
  await page.viewport(390, 844);
  const { store, assistant } = setup();
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  await screen.getByRole("button", { name: "Hide projects" }).click();
  await screen.getByRole("textbox", { name: "Your writing" }).fill("A thought on the move.");
  await screen.getByRole("button", { name: "Show context, todos, and designer" }).click();
  await screen.getByRole("textbox", { name: "Your intent" }).fill("Keep this thought.");
  await screen.getByRole("button", { name: "Close right pane" }).click();
  await screen.getByRole("button", { name: "Designed", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Your writing" }))
    .toHaveTextContent("A thought on the move.");
  const app = screen.container.querySelector(".whisk-app")!;
  expect(app.scrollWidth).toBeLessThanOrEqual(390);
});
