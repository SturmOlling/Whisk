import { describe, expect, it } from "vite-plus/test";
import {
  assistanceSource,
  applyWritingAssistance,
  createWritingStore,
  decodeWritingWorkspace,
  newWritingDocument,
  newWritingWorkspace,
  parseWritingAssistance,
  WRITING_STORAGE_KEY,
} from "./writing.logic";

function memoryStorage(initial?: string) {
  const values = new Map<string, string>(initial ? [[WRITING_STORAGE_KEY, initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("writing persistence", () => {
  it("restores each document and attributes a late suggestion to its original document", () => {
    const storage = memoryStorage();
    const store = createWritingStore(storage);
    const original = store.getSnapshot().workspace.documents[0]!;
    store.updateDocument(original.id, (document) => ({
      ...document,
      text: "The first thought.",
      context: "Help a friend.",
      answers: { Why: "To connect." },
    }));
    const source = assistanceSource(store.getSnapshot().workspace.documents[0]!);
    const next = newWritingDocument(original.projectId);
    store.update((state) => ({
      ...state,
      documents: [...state.documents, next],
      activeDocumentId: next.id,
    }));
    store.updateDocument(original.id, (document) => ({
      ...document,
      text: "A more considered thought.",
      assistance: {
        outline: [{ heading: "A story", body: "Describe what happened." }],
        questions: [],
        source,
        generatedAt: "2026-11-17T00:00:00.000Z",
      },
    }));
    const restored = createWritingStore(storage).getSnapshot().workspace;
    expect(restored.activeDocumentId).toBe(next.id);
    expect(restored.documents[1]!.text).toBe("");
    expect(restored.documents[1]!.assistance).toBeNull();
    expect(restored.documents[0]!.answers).toEqual({ Why: "To connect." });
    expect(restored.documents[0]!.text).toBe("A more considered thought.");
    expect(restored.documents[0]!.assistance!.source).not.toBe(
      assistanceSource(restored.documents[0]!),
    );
  });

  it("leaves unreadable storage untouched and retains new writing in memory", () => {
    const storage = memoryStorage('{"version":99,"text":"precious writing"}');
    const original = storage.getItem(WRITING_STORAGE_KEY);
    const store = createWritingStore(storage);
    const id = store.getSnapshot().workspace.activeDocumentId;
    store.updateDocument(id, (document) => ({ ...document, text: "Still writing." }));
    expect(store.getSnapshot().error).toContain("left untouched");
    expect(store.getSnapshot().workspace.documents[0]!.text).toBe("Still writing.");
    expect(storage.getItem(WRITING_STORAGE_KEY)).toBe(original);
    expect(() => store.importBackup("invalid")).toThrow();
    expect(store.getSnapshot().workspace.documents[0]!.text).toBe("Still writing.");
    store.importBackup(JSON.stringify(newWritingWorkspace()));
    expect(store.getSnapshot().error).toBeNull();
    expect(decodeWritingWorkspace(storage.getItem(WRITING_STORAGE_KEY)!)).toEqual(
      store.getSnapshot().workspace,
    );
  });

  it("reports quota failure without dropping the latest edit and recovers on a later save", () => {
    let full = true;
    const storage = memoryStorage();
    const store = createWritingStore({
      ...storage,
      setItem: (key, value) => {
        if (full) throw new Error("Quota exceeded");
        storage.setItem(key, value);
      },
    });
    const id = store.getSnapshot().workspace.activeDocumentId;
    store.updateDocument(id, (document) => ({ ...document, text: "Keep this." }));
    expect(store.getSnapshot().workspace.documents[0]!.text).toBe("Keep this.");
    expect(store.getSnapshot().error).toContain("Export a backup");
    full = false;
    store.updateDocument(id, (document) => ({ ...document, text: "Keep this too." }));
    expect(store.getSnapshot().error).toBeNull();
    expect(createWritingStore(storage).getSnapshot().workspace.documents[0]!.text).toBe(
      "Keep this too.",
    );
  });

  it("preserves both versions when another tab writes to the same workspace", () => {
    const storage = memoryStorage(JSON.stringify(newWritingWorkspace()));
    const first = createWritingStore(storage);
    const second = createWritingStore(storage);
    const id = first.getSnapshot().workspace.activeDocumentId;
    first.updateDocument(id, (document) => ({ ...document, text: "Written in the first tab." }));
    second.updateDocument(id, (document) => ({ ...document, text: "Written in the second tab." }));
    expect(second.getSnapshot().error).toContain("another tab");
    expect(second.getSnapshot().workspace.documents[0]!.text).toBe("Written in the second tab.");
    expect(createWritingStore(storage).getSnapshot().workspace.documents[0]!.text).toBe(
      "Written in the first tab.",
    );
  });

  it("rejects backups with duplicate identities, missing projects, or missing active documents", () => {
    const state = newWritingWorkspace();
    for (const invalid of [
      { ...state, projects: [...state.projects, state.projects[0]] },
      { ...state, documents: [...state.documents, state.documents[0]] },
      { ...state, activeDocumentId: "missing" },
      { ...state, projects: [] },
    ])
      expect(() => decodeWritingWorkspace(JSON.stringify(invalid))).toThrow();
  });
});

it("validates model output, deduplicates passages/questions, and rejects oversized or malformed suggestions", () => {
  const output = {
    outline: [
      { heading: "Opening", body: "Set the scene." },
      { heading: "Opening", body: "Introduce the problem." },
    ],
    questions: ["Who is reading?", " Who is reading? "],
  };
  expect(parseWritingAssistance(`\`\`\`json\n${JSON.stringify(output)}\n\`\`\``)).toEqual({
    outline: [output.outline[1]],
    questions: ["Who is reading?"],
  });
  for (const invalid of [
    "no JSON",
    '{"outline":"text","questions":[]}',
    JSON.stringify({ outline: [], questions: ["x".repeat(2_001)] }),
  ]) {
    expect(() => parseWritingAssistance(invalid)).toThrow();
  }
});

it("applies generated design without replacing newer writing or design directions", () => {
  const original = newWritingDocument("project");
  const output = {
    outline: [],
    questions: [],
    design: { layout: "letter", font: "sans", accent: "#123456" },
  } as const;
  const result = applyWritingAssistance(original, original, output, "2026-11-17T00:00:00.000Z");
  expect(result.design.layout).toBe("letter");
  expect(result.assistance!.source).toBe(assistanceSource(result));
  const edited = { ...original, text: "Written while the assistant was thinking." };
  const late = applyWritingAssistance(edited, original, output, "2026-11-17T00:00:00.000Z");
  expect(late.text).toBe(edited.text);
  expect(late.assistance!.source).not.toBe(assistanceSource(late));
  const redirected = {
    ...edited,
    design: { ...edited.design, instructions: "A different direction." },
  };
  const unchanged = applyWritingAssistance(
    redirected,
    original,
    output,
    "2026-11-17T00:00:00.000Z",
  );
  expect(unchanged.design).toEqual(redirected.design);
  expect(unchanged.assistance!.source).not.toBe(assistanceSource(unchanged));
});
