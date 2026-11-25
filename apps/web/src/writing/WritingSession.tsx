import { createContext, use, useState, useSyncExternalStore, type ReactNode } from "react";
import { createWritingStore, type WritingStore } from "./writing.logic";
import { useWritingAssistant } from "./useWritingAssistant";
import type { WritingAssistant } from "./WritingWorkspace";
import { useWritingFiles, type WritingFolderActions } from "./useWritingFiles";

const Session = createContext<{
  store: WritingStore;
  assistant: WritingAssistant;
  folders: WritingFolderActions;
} | null>(null);

export function WritingSessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    createWritingStore({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    }),
  );
  const folder = useSyncExternalStore(store.subscribe, () => {
    const { workspace } = store.getSnapshot();
    const projectId = workspace.documents.find(
      (item) => item.id === workspace.activeDocumentId,
    )?.projectId;
    return workspace.projects.find((item) => item.id === projectId)?.folder ?? null;
  });
  const assistant = useWritingAssistant(folder);
  const folders = useWritingFiles(store);
  return <Session value={{ store, assistant, folders }}>{children}</Session>;
}

export function useWritingSession() {
  const session = use(Session);
  if (!session) throw new Error("Writing session is unavailable.");
  return session;
}
