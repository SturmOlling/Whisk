import { describe, expect, it } from "vite-plus/test";
import {
  assistanceSource,
  applyWritingAssistance,
  applyHighlightReply,
  createWritingStore,
  decodeWritingWorkspace,
  newWritingDocument,
  newWritingWorkspace,
  newWritingAnnotation,
  findWritingAnchor,
  saveWritingAnnotation,
  writingAssistantPrompt,
  isHighlightReplyStale,
  plainWritingBlocks,
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
  it("migrates old outline-view drafts and backups without losing writing or context", () => {
    const state = newWritingWorkspace();
    const legacy = {
      ...state,
      view: "outline",
      includeOutline: false,
      documents: state.documents.map(
        ({
          annotations: _annotations,
          todos: _todos,
          blocks: _blocks,
          fileName: _fileName,
          ...document
        }) => ({
          ...document,
          text: "An existing draft.",
          context: "An existing intention.",
        }),
      ),
    };
    const storage = memoryStorage(JSON.stringify(legacy));
    const store = createWritingStore(storage);
    const restored = store.getSnapshot().workspace;
    expect(store.getSnapshot().error).toBeNull();
    expect(restored.view).toBe("sparse");
    expect(restored.includeOutline).toBe(true);
    expect(restored.documents[0]).toMatchObject({
      text: "An existing draft.",
      context: "An existing intention.",
      annotations: [],
      todos: [],
    });
    store.update((current) => ({ ...current, view: "review" }));
    expect(createWritingStore(storage).getSnapshot().workspace.documents).toEqual(
      restored.documents,
    );
  });

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

describe("writing highlights", () => {
  it("keeps quote anchors attached after edits and retains missing passages and linked todos", () => {
    let document = {
      ...newWritingDocument("project"),
      text: "First repeated phrase. Second repeated phrase.",
    };
    const start = document.text.lastIndexOf("repeated phrase");
    const annotation = newWritingAnnotation(
      document.text,
      start,
      start + "repeated phrase".length,
      "unclear",
      "Clarify the second claim.",
      "todo",
    );
    document = saveWritingAnnotation(document, annotation);
    expect(document.todos[0]).toMatchObject({
      text: "Clarify the second claim.",
      annotationId: annotation.id,
      done: false,
    });
    expect(findWritingAnchor(`A new introduction. ${document.text}`, annotation)).toBe(
      start + "A new introduction. ".length,
    );
    expect(findWritingAnchor("Both passages were rewritten.", annotation)).toBeNull();
    document = saveWritingAnnotation(document, {
      ...annotation,
      note: "Check the source.",
      resolved: true,
    });
    expect(document.todos).toHaveLength(1);
    expect(document.todos[0]).toMatchObject({ text: "Check the source.", done: true });
    const state = newWritingWorkspace();
    const draft = {
      ...document,
      projectId: state.projects[0]!.id,
      text: "Both passages were rewritten.",
      blocks: plainWritingBlocks("Both passages were rewritten."),
    };
    const restored = decodeWritingWorkspace(
      JSON.stringify({ ...state, documents: [draft], activeDocumentId: draft.id }),
    );
    expect(restored.documents[0]!.annotations[0]!.quote).toBe("repeated phrase");
    expect(restored.documents[0]!.todos[0]!.annotationId).toBe(annotation.id);
    for (const invalid of [
      { ...draft, annotations: [annotation, annotation] },
      { ...draft, todos: [{ ...draft.todos[0]!, annotationId: "missing" }] },
    ])
      expect(() =>
        decodeWritingWorkspace(
          JSON.stringify({ ...state, documents: [invalid], activeDocumentId: draft.id }),
        ),
      ).toThrow();
  });

  it("sends only the chosen highlight's instruction and stores late replies without rewriting or resurrecting a deleted mark", () => {
    const document = { ...newWritingDocument("project"), text: "A draft to improve." };
    const selected = newWritingAnnotation(
      document.text,
      0,
      7,
      "comment",
      "Give me a stronger opening.",
      "agent",
    );
    const privateNote = newWritingAnnotation(
      document.text,
      8,
      10,
      "good",
      "SECRET PRIVATE NOTE",
      "note",
    );
    const original = saveWritingAnnotation(saveWritingAnnotation(document, selected), privateNote);
    const prompt = writingAssistantPrompt(original, {
      kind: "highlight",
      annotationId: selected.id,
    });
    expect(prompt).toContain("Give me a stronger opening.");
    expect(prompt).not.toContain("SECRET PRIVATE NOTE");
    expect(writingAssistantPrompt(original, "outline")).not.toContain("SECRET PRIVATE NOTE");
    const current = {
      ...original,
      text: "A newer draft.",
      annotations: original.annotations.map((item) =>
        item.id === selected.id ? { ...item, note: "A newer thought." } : item,
      ),
    };
    const result = applyHighlightReply(
      current,
      original,
      selected.id,
      '{"reply":"Try a concrete scene."}',
    );
    expect(result.text).toBe("A newer draft.");
    expect(result.annotations[0]).toMatchObject({
      note: "A newer thought.",
      resolved: false,
      reply: { text: "Try a concrete scene.", source: expect.any(String) },
    });
    expect(isHighlightReplyStale(result, result.annotations[0]!)).toBe(true);
    const fresh = applyHighlightReply(
      original,
      original,
      selected.id,
      '{"reply":"A fresh response."}',
    );
    expect(isHighlightReplyStale(fresh, fresh.annotations[0]!)).toBe(false);
    expect(
      isHighlightReplyStale({ ...fresh, context: "A new intention." }, fresh.annotations[0]!),
    ).toBe(true);
    const deleted = { ...current, annotations: [] };
    expect(
      applyHighlightReply(deleted, original, selected.id, '{"reply":"Late response."}').annotations,
    ).toEqual([]);
    for (const raw of [
      '{"reply":""}',
      '{"reply":"  "}',
      '{"outline":[]}',
      JSON.stringify({ reply: "x".repeat(20_001) }),
    ])
      expect(() => applyHighlightReply(current, original, selected.id, raw)).toThrow();
    for (const [start, end] of [
      [0, 0],
      [-1, 2],
      [1, 999],
      [NaN, 2],
      [0.5, 2],
    ])
      expect(() =>
        newWritingAnnotation(document.text, start!, end!, "comment", "", "note"),
      ).toThrow();
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
  expect(late.design).toEqual(edited.design);
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

it("asks for design based on the current draft, context, answers, and audience", () => {
  const blank = newWritingDocument("project");
  const document = {
    ...blank,
    text: "Dear readers,",
    context: "Invite neighbors to a meeting.",
    answers: { "Who should attend?": "Anyone on the street." },
    design: { ...blank.design, audience: "Neighbors", instructions: "A personal letter." },
  };
  const prompt = writingAssistantPrompt(document, "design");
  expect(prompt).toContain('"design":{"layout":"editorial","font":"serif","accent":"#486556"}');
  const source = JSON.parse(prompt.split("\n\n").at(-1)!);
  expect(source).toMatchObject({
    writing: document.text,
    intent: document.context,
    answers: document.answers,
    design: document.design,
  });
});
