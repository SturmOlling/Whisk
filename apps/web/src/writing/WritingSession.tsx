import { createContext, use, useState, type ReactNode } from "react";
import { createWritingStore, type WritingStore } from "./writing.logic";
import { useWritingAssistant } from "./useWritingAssistant";
import type { WritingAssistant } from "./WritingWorkspace";

const Session = createContext<{ store: WritingStore; assistant: WritingAssistant } | null>(null);

export function WritingSessionProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() =>
    createWritingStore({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    }),
  );
  const assistant = useWritingAssistant();
  return <Session value={{ store, assistant }}>{children}</Session>;
}

export function useWritingSession() {
  const session = use(Session);
  if (!session) throw new Error("Writing session is unavailable.");
  return session;
}
