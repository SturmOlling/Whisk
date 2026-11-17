import { createFileRoute, redirect } from "@tanstack/react-router";
import { WritingWorkspace } from "../writing/WritingWorkspace";
import { useWritingSession } from "../writing/WritingSession";

function WriteRoute() {
  const { assistant, store } = useWritingSession();
  return <WritingWorkspace assistant={assistant} store={store} />;
}

export const Route = createFileRoute("/write")({
  beforeLoad: ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: WriteRoute,
});
