import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

import { useStableCallback } from "../../hooks/useStableCallback";
import { type EnvironmentId, type ThreadId, type RunId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { newThreadId } from "~/lib/utils";
import { buildThreadRouteParams } from "../../threadRoutes";
import { threadEnvironment } from "../../state/threads";
import { waitForThreadShell } from "../../state/entities";

import { useAtomCommand } from "../../state/use-atom-command";

import { makeThreadErrorSetter } from "../ChatView.logic";
interface TimelineForkInput {
  readonly environmentId: EnvironmentId;

  readonly activeThread: EnvironmentThreadShell | undefined;

  readonly activeEnvironmentUnavailable: boolean;

  readonly setThreadError: ReturnType<typeof makeThreadErrorSetter>;
}

export function useTimelineFork(input: TimelineForkInput) {
  const {
    environmentId,

    activeThread,

    activeEnvironmentUnavailable,

    setThreadError,
  } = input;
  const navigate = useNavigate();

  const forkThreadFromRun = useAtomCommand(threadEnvironment.forkFromRun, {
    reportFailure: false,
  });
  const onForkFromRun = async (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => {
    if (!activeThread || activeEnvironmentUnavailable) return;
    const targetThreadId = newThreadId();
    const targetThreadRef = scopeThreadRef(environmentId, targetThreadId);
    const result = await forkThreadFromRun({
      environmentId,
      input: {
        sourceThreadId: input.sourceThreadId,
        targetThreadId,
        runId: input.runId,
        title: `${activeThread.title} fork`,
      },
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setThreadError(
          activeThread.id,
          error instanceof Error ? error.message : "Failed to fork this response.",
        );
      }
      return;
    }
    const targetThreadReady = await waitForThreadShell(targetThreadRef);
    if (!targetThreadReady) {
      setThreadError(
        activeThread.id,
        "The fork was created, but its thread data did not reach this client. Reconnect and try opening it from the sidebar.",
      );
      return;
    }
    await navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(targetThreadRef),
    });
  };
  const onForkFromRunStable = useStableCallback(onForkFromRun);
  return {
    onForkFromRunStable,
  };
}
