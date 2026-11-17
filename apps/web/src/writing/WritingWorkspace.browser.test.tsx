import { expect, it } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { WritingWorkspace, type WritingAssistant } from "./WritingWorkspace";
import { assistanceSource, createWritingStore } from "./writing.logic";

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

it("preserves writing and the editor across view changes, edits context/design, and restores the saved session", async () => {
  await page.viewport(1440, 900);
  const { store, storage, assistant } = setup();
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  const editor = screen.getByRole("textbox", { name: "Your writing" });
  await expect.element(editor).toHaveValue("");
  const element = editor.element();
  await editor.fill("The first sentence belongs to me.");
  await screen.getByRole("textbox", { name: "Document title" }).fill("A beginning");
  await screen.getByRole("button", { name: "Shadow outline", exact: true }).click();
  await expect.element(editor).toHaveValue("The first sentence belongs to me.");
  expect(editor.element()).toBe(element);
  await screen.getByRole("button", { name: "Open context", exact: false }).click();
  await screen
    .getByRole("textbox", { name: "Your intent" })
    .fill("I am trying to explain a new idea.");
  await screen.getByRole("button", { name: "Designer", exact: true }).click();
  await screen.getByRole("textbox", { name: "Who is this for?" }).fill("curious readers");
  await screen.getByRole("textbox", { name: "Where is this for?" }).fill("A journal");
  await screen.getByRole("combobox", { name: "Page layout" }).selectOptions("note");
  await screen.getByRole("button", { name: "See designed view" }).click();
  await expect.element(screen.getByRole("checkbox", { name: "Include outline" })).toBeChecked();
  await expect.element(screen.getByText("For curious readers")).toBeVisible();
  await expect.element(editor).toHaveValue("The first sentence belongs to me.");
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
    .toHaveValue("The first sentence belongs to me.");
  expect(restored.getSnapshot().workspace.documents[0]!.context).toBe(
    "I am trying to explain a new idea.",
  );
  expect(restored.getSnapshot().workspace.documents[0]!.design.layout).toBe("note");
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
  await expect.element(editor).toHaveValue("My opening.");
  await screen.getByRole("checkbox", { name: "Include outline" }).click();
  await expect
    .element(screen.getByRole("heading", { name: "What comes next" }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Shadow outline", exact: true }).click();
  await screen.getByRole("button", { name: "Use passage" }).click();
  await expect
    .element(editor)
    .toHaveValue("My opening.\n\n## What comes next\n\nExplore an unexpected consequence.");
  await screen.getByRole("button", { name: "New document" }).click();
  await expect.element(editor).toHaveValue("");
  const files = screen.getByRole("navigation", { name: "Writing projects" });
  await files.getByRole("button", { name: "Untitled", exact: true }).first().click();
  await expect
    .element(editor)
    .toHaveValue("My opening.\n\n## What comes next\n\nExplore an unexpected consequence.");
});

it("creates a project using a focus-contained dialog and supports keyboard dismissal", async () => {
  await page.viewport(1440, 900);
  const { store, assistant } = setup();
  await using screen = await render(<WritingWorkspace store={store} assistant={assistant} />);
  await screen.getByRole("button", { name: "New project", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "A home for an idea." });
  await dialog.getByRole("textbox", { name: "Project name" }).fill("Essays");
  await dialog.getByRole("button", { name: "Create project" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(screen.getByRole("textbox", { name: "Your writing" })).toHaveValue("");
  expect(store.getSnapshot().workspace.projects.map((project) => project.name)).toEqual([
    "My writing",
    "Essays",
  ]);
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
  await screen.getByRole("button", { name: "Show context and designer" }).click();
  await screen.getByRole("textbox", { name: "Your intent" }).fill("Keep this thought.");
  await screen.getByRole("button", { name: "Close right pane" }).click();
  await screen.getByRole("button", { name: "Designed", exact: true }).click();
  await expect
    .element(screen.getByRole("textbox", { name: "Your writing" }))
    .toHaveValue("A thought on the move.");
  const app = screen.container.querySelector(".whisk-app")!;
  expect(app.scrollWidth).toBeLessThanOrEqual(390);
});
