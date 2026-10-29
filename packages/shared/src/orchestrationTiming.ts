import { isOrchestrationV2WorkActive, type OrchestrationV2Subagent } from "@t3tools/contracts";

export function deriveSubagentElapsedMs(
  agent: {
    readonly status: OrchestrationV2Subagent["status"];
    readonly startedAt: string | null;
    readonly completedAt: string | null;
  },
  nowMs: number,
): number | null {
  if (agent.startedAt === null) return null;
  const end = isOrchestrationV2WorkActive(agent.status)
    ? nowMs
    : agent.completedAt === null
      ? null
      : Date.parse(agent.completedAt);
  if (end === null) return null;
  const start = Date.parse(agent.startedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

type LatestRunTiming = {
  readonly runId: string | null;
  readonly requestedAt?: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

type RuntimeActivityState = {
  readonly orchestrationStatus: string;
  readonly activeRunId?: string | null;
};

function isLatestRunSettled(
  latestRun: LatestRunTiming | null,
  runtime: RuntimeActivityState | null,
): boolean {
  if (!latestRun) return false;
  if (!latestRun.completedAt) return false;
  if (!runtime) return true;
  if (runtime.orchestrationStatus === "running") return false;
  return true;
}

/** Fall back during provider startup; the projector stamps startedAt only when the session becomes running. */
export function deriveActiveWorkStartedAt(
  latestRun: LatestRunTiming | null,
  runtime: RuntimeActivityState | null,
  sendStartedAt: string | null,
): string | null {
  if (runtime?.activeRunId && runtime.activeRunId !== latestRun?.runId) {
    return sendStartedAt;
  }
  if (!isLatestRunSettled(latestRun, runtime)) {
    return latestRun?.startedAt ?? latestRun?.requestedAt ?? sendStartedAt;
  }
  return sendStartedAt;
}
