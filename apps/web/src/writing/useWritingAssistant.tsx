/* oxlint-disable shadcn/no-unknown-classes -- Writing controls use the feature stylesheet. */
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ThreadId,
} from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useScratchProject } from "../hooks/useScratchProject";
import {
  useEnvironments,
  useEnvironmentProviders,
  usePrimaryEnvironmentId,
} from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { useEnvironmentThread, threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { primaryServerSettingsAtom } from "../state/server";
import { useProjects } from "../state/entities";
import { newMessageId, newThreadId } from "../lib/utils";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  applyWritingAssistance,
  applyHighlightReply,
  parseWritingAssistance,
  writingAssistantPrompt,
  type WritingDocument,
  type WritingFolder,
  type WritingStore,
  type WritingPurpose,
} from "./writing.logic";
import type { WritingAssistant } from "./WritingWorkspace";

const nowIso = () => new Date().toISOString();

interface Request {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly messageId: MessageId;
  readonly documentId: string;
  readonly original: WritingDocument;
  readonly purpose: WritingPurpose;
  readonly store: WritingStore;
}

const UNUSABLE_RESPONSE =
  "The assistant did not return a usable response. Your draft and previous suggestions are unchanged. Open its thread to inspect the response or try again.";

export function useWritingAssistant(folder: WritingFolder | null | undefined): WritingAssistant {
  const primaryId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const settings = useAtomValue(primaryServerSettingsAtom);
  const { scratchEnvironmentId, scratchWorkspaceRootFor, openScratchProject } = useScratchProject();
  const environmentId = folder?.environmentId ?? primaryId ?? scratchEnvironmentId(null);
  const projects = useProjects().filter(
    (project) => project.environmentId === environmentId && project.archivedAt == null,
  );
  const [projectChoice, setProjectChoice] = useState("");
  const workspaceProject =
    projects.find((project) => project.id === projectChoice) ??
    projects.find((project) => project.id === folder?.projectId) ??
    projects[0];
  const hasWorkspace =
    workspaceProject !== undefined || scratchWorkspaceRootFor(environmentId) !== null;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interrupt = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const [choice, setChoice] = useState("");
  const [request, setRequest] = useState<Request | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(0);
  const consumed = useRef<ThreadId | null>(null);
  const detail = useEnvironmentThread(request?.environmentId ?? null, request?.threadId ?? null);
  const providers = environmentId === null ? [] : (providersByEnvironment.get(environmentId) ?? []);
  const options = providers
    .filter(
      (provider) =>
        provider.enabled &&
        provider.installed &&
        provider.status !== "error" &&
        provider.auth.status !== "unauthenticated",
    )
    .flatMap((provider) =>
      provider.models
        .filter((model) => !model.isLegacy)
        .map((model) => ({
          key: JSON.stringify([provider.instanceId, model.slug]),
          selection: {
            instanceId: provider.instanceId,
            model: model.slug,
          } satisfies ModelSelection,
          label: `${provider.displayName ?? provider.driver} · ${model.name}`,
        })),
    );
  const environmentSettings = environments.find(
    (environment) => environment.environmentId === environmentId,
  )?.serverConfig?.settings;
  const preferred = environmentSettings?.defaultModelSelection ?? settings.defaultModelSelection;
  const selected =
    options.find((option) => option.key === choice) ??
    options.find(
      (option) =>
        option.selection.instanceId === preferred?.instanceId &&
        option.selection.model === preferred.model,
    ) ??
    options[0];

  const receive = useEffectEvent((state: typeof detail, activeRequest: Request | null) => {
    if (!activeRequest || consumed.current === activeRequest.threadId) return;
    if (Option.isSome(state.error) || state.status === "deleted") {
      consumed.current = activeRequest.threadId;
      setError(Option.getOrElse(state.error, () => "The writing assistant thread is unavailable."));
      setBusy(false);
      inFlight.current = false;
      return;
    }
    if (Option.isNone(state.data)) return;
    const projection = state.data.value;
    const run = projection.runs.findLast((item) => item.userMessageId === activeRequest.messageId);
    if (!run || ["preparing", "queued", "starting", "running", "waiting"].includes(run.status))
      return;
    consumed.current = activeRequest.threadId;
    setBusy(false);
    inFlight.current = false;
    if (run.status !== "completed") {
      setError(
        run.status === "interrupted" || run.status === "cancelled"
          ? "Generation stopped. Your draft is unchanged."
          : "The assistant could not finish. Open its thread for details, then try again.",
      );
      return;
    }
    const reply = projection.messages
      .filter(
        (message) => message.role === "assistant" && message.runId === run.id && !message.streaming,
      )
      .at(-1);
    if (!reply) {
      setError("The assistant finished without a response. Open its thread to inspect the result.");
      return;
    }
    try {
      if (typeof activeRequest.purpose === "object") {
        const { annotationId } = activeRequest.purpose;
        activeRequest.store.updateDocument(activeRequest.documentId, (document) =>
          applyHighlightReply(document, activeRequest.original, annotationId, reply.text),
        );
        setError(null);
        return;
      }
      const output = parseWritingAssistance(reply.text);
      if (activeRequest.purpose === "design" && !output.design) {
        setError(UNUSABLE_RESPONSE);
        return;
      }
      activeRequest.store.updateDocument(activeRequest.documentId, (document) =>
        applyWritingAssistance(
          document,
          activeRequest.original,
          activeRequest.purpose === "design"
            ? output
            : { outline: output.outline, questions: output.questions },
          nowIso(),
        ),
      );
      setError(null);
    } catch {
      setError(UNUSABLE_RESPONSE);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- consumes updates from the external agent thread
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- completion arrives through the external thread subscription
    receive(detail, request);
  }, [detail, request]);

  const generate = async (
    document: WritingDocument,
    store: WritingStore,
    purpose: WritingPurpose = "outline",
  ) => {
    if (inFlight.current || !selected || environmentId === null || !canOperate) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const token = ++generation.current;
    setRequest(null);
    try {
      const project =
        workspaceProject ??
        (await openScratchProject(environmentId, "Could not open the writing assistant"));
      if (token !== generation.current) return;
      if (!project) {
        setError("Could not open the writing assistant. Check your environment connection.");
        setBusy(false);
        inFlight.current = false;
        return;
      }
      const threadId = newThreadId();
      const nextRequest = {
        environmentId,
        threadId,
        messageId: newMessageId(),
        documentId: document.id,
        original: document,
        purpose,
        store,
      };
      const result = await startTurn({
        environmentId,
        input: {
          threadId,
          message: {
            messageId: nextRequest.messageId,
            role: "user",
            text: writingAssistantPrompt(document, purpose),
            attachments: [],
          },
          modelSelection: selected.selection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          bootstrap: {
            createThread: {
              projectId: project.id,
              title: `Writing: ${(document.title || "Untitled").slice(0, 100)}`,
              modelSelection: selected.selection,
              runtimeMode: "approval-required",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              createdAt: nowIso(),
            },
          },
        },
      });
      if (token !== generation.current) {
        if (result._tag === "Success") await interrupt({ environmentId, input: { threadId } });
        return;
      }
      if (result._tag === "Failure") {
        consumed.current = threadId;
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : "Could not start the writing assistant.");
        setBusy(false);
        inFlight.current = false;
      } else setRequest(nextRequest);
    } catch (cause) {
      if (token !== generation.current) return;
      setError(cause instanceof Error ? cause.message : "Could not start the writing assistant.");
      setBusy(false);
      inFlight.current = false;
    }
  };
  const cancel = async () => {
    const token = ++generation.current;
    setBusy(false);
    inFlight.current = false;
    setError("Generation stopped. Your draft is unchanged.");
    if (!request) return;
    consumed.current = request.threadId;
    const result = await interrupt({
      environmentId: request.environmentId,
      input: { threadId: request.threadId },
    });
    if (token === generation.current && result._tag === "Failure") {
      setError("Could not stop the assistant. Open its thread to manage it.");
    }
  };
  const waiting = Option.isSome(detail.data) && detail.data.value.runs.at(-1)?.status === "waiting";
  return {
    busy,
    available: selected !== undefined && environmentId !== null && canOperate && hasWorkspace,
    label: waiting
      ? "The assistant needs your attention. Open its thread to continue."
      : environmentId === null
        ? "Connect an environment to use writing assistance."
        : !canOperate
          ? "This environment connection does not currently allow agent requests."
          : !hasWorkspace
            ? "Add a workspace in Agent workspace to enable writing assistance."
            : selected
              ? `Writing assistant · ${selected.label}`
              : "Connect an agent to get outlines and optional questions.",
    error,
    thread: request ? scopeThreadRef(request.environmentId, request.threadId) : null,
    generate: (document, store, purpose) => {
      void generate(document, store, purpose);
    },
    cancel: () => {
      void cancel();
    },
    controls: options.length ? (
      <>
        <label className="whisk-field">
          <span>Writing assistant</span>
          <select
            aria-label="Assistant model"
            disabled={busy}
            value={selected?.key ?? ""}
            onChange={(event) => setChoice(event.target.value)}
          >
            {options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {projects.length > 0 && (
          <label className="whisk-field">
            <span>Assistant workspace</span>
            <select
              aria-label="Assistant workspace"
              disabled={busy}
              value={workspaceProject?.id ?? ""}
              onChange={(event) => setProjectChoice(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </>
    ) : null,
  };
}
