import { expect, it, vi } from "vite-plus/test";
import type { RouterProbeResult } from "@madar/contracts";
import { superviseConnection, type ConnectionState } from "./supervisor";
function fakeTimers() {
  vi.useFakeTimers();
  return {
    [Symbol.dispose]: () => {
      vi.useRealTimers();
    },
  };
}

it("recovers from a brief interruption without showing an offline state", async () => {
  using _timers = fakeTimers();
  const states: ConnectionState[] = [];
  const connected: RouterProbeResult = {
    kind: "connected",
    service: "router-api",
    identity: "Office",
    version: "6.49",
  };
  const probe = vi
    .fn<() => Promise<RouterProbeResult>>()
    .mockResolvedValueOnce(connected)
    .mockResolvedValueOnce({ kind: "failed", reason: "network" })
    .mockResolvedValue(connected);
  const stop = superviseConnection({ probe, publish: (state) => states.push(state) });
  try {
    await vi.advanceTimersByTimeAsync(31000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(states.map(({ kind }) => kind)).toEqual(["connecting", "connected", "connected"]);
  } finally {
    stop();
  }
});
it("stops reconnecting after five failures", async () => {
  using _timers = fakeTimers();
  const states: ConnectionState[] = [];
  const probe = vi
    .fn<() => Promise<RouterProbeResult>>()
    .mockResolvedValue({ kind: "failed", reason: "network" });
  const stop = superviseConnection({ probe, publish: (state) => states.push(state) });
  try {
    await vi.advanceTimersByTimeAsync(60000);
    expect(probe).toHaveBeenCalledTimes(5);
    expect(states.at(-1)).toEqual({ kind: "failed", reason: "network" });
  } finally {
    stop();
  }
});
it("does not retry rejected authentication and cancels scheduled work on disconnect", async () => {
  using _timers = fakeTimers();
  const publish = vi.fn();
  const probe = vi
    .fn<() => Promise<RouterProbeResult>>()
    .mockResolvedValue({ kind: "failed", reason: "authentication" });
  const stop = superviseConnection({ probe, publish });
  await vi.advanceTimersByTimeAsync(60000);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenLastCalledWith({ kind: "failed", reason: "authentication" });
  stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(probe).toHaveBeenCalledTimes(1);
});
it("ignores a completed request after switching routers", async () => {
  let complete: (result: RouterProbeResult) => void = () => {};
  const promise = new Promise<RouterProbeResult>((resolve) => {
    complete = resolve;
  });
  const publish = vi.fn();
  const stop = superviseConnection({ probe: () => promise, publish });
  stop();
  complete({ kind: "connected", service: "router-api", identity: "Old router", version: "6.49" });
  await promise;
  expect(publish).toHaveBeenCalledTimes(1);
});
