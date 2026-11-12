import type { RouterProbeResult } from "@madar/contracts";

export type ConnectionState =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | Extract<RouterProbeResult, { kind: "connected" }>
  | { kind: "reconnecting"; attempt: number; reason: FailureReason }
  | { kind: "failed"; reason: FailureReason };
type FailureReason = Extract<RouterProbeResult, { kind: "failed" }>["reason"] | "app";

export function superviseConnection({
  probe,
  publish,
}: {
  probe: (signal: AbortSignal) => Promise<RouterProbeResult>;
  publish: (state: ConnectionState) => void;
}) {
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let connected = false;
  const run = async () => {
    let result: RouterProbeResult | { kind: "failed"; reason: "app" };
    try {
      result = await probe(abort.signal);
    } catch {
      result = { kind: "failed", reason: "app" };
    }
    if (abort.signal.aborted) return;
    clearTimeout(delay);
    if (result.kind === "connected") {
      clearTimeout(delay);
      failures = 0;
      connected = true;
      publish(result);
      timer = setTimeout(() => void run(), 30000);
    } else {
      failures++;
      const { reason } = result;
      const terminal = !["network", "timeout", "app"].includes(reason) || failures >= 5;
      const next: ConnectionState = terminal
        ? { kind: "failed", reason }
        : { kind: "reconnecting", attempt: failures, reason };
      if (connected && failures === 1 && !terminal) {
        delay = setTimeout(() => publish(next), 2500);
      } else publish(next);
      if (!terminal)
        timer = setTimeout(() => void run(), Math.min(1000 * 2 ** (failures - 1), 15000));
    }
  };
  publish({ kind: "connecting" });
  void run();
  return () => {
    abort.abort();
    clearTimeout(timer);
    clearTimeout(delay);
  };
}
