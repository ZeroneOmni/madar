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

it("recovers on the next 30-second check after an interruption", async () => {
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
    await vi.advanceTimersByTimeAsync(60000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(states.map(({ kind }) => kind)).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
  } finally {
    stop();
  }
});
it("keeps trying every 30 seconds through a long outage and recovers", async () => {
  using _timers = fakeTimers();
  const states: ConnectionState[] = [];
  const probe = vi
    .fn<() => Promise<RouterProbeResult>>()
    .mockResolvedValue({ kind: "failed", reason: "network" });
  const stop = superviseConnection({ probe, publish: (state) => states.push(state) });
  try {
    await vi.advanceTimersByTimeAsync(300000);
    expect(probe).toHaveBeenCalledTimes(11);
    expect(states.at(-1)).toEqual({ kind: "reconnecting", attempt: 11, reason: "network" });
    probe.mockResolvedValue({
      kind: "connected",
      service: "router-api",
      identity: "Office",
      version: "6.49",
    });
    await vi.advanceTimersByTimeAsync(29999);
    expect(probe).toHaveBeenCalledTimes(11);
    await vi.advanceTimersByTimeAsync(1);
    expect(states.at(-1)?.kind).toBe("connected");
  } finally {
    stop();
  }
});

it("disconnect cancels future retries even after a long outage", async () => {
  using _timers = fakeTimers();
  const probe = vi
    .fn<() => Promise<RouterProbeResult>>()
    .mockResolvedValue({ kind: "failed", reason: "timeout" });
  const stop = superviseConnection({ probe, publish: vi.fn() });
  await vi.advanceTimersByTimeAsync(300000);
  expect(probe).toHaveBeenCalledTimes(11);
  stop();
  await vi.advanceTimersByTimeAsync(300000);
  expect(probe).toHaveBeenCalledTimes(11);
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

it("does not overlap slow checks or reconnect after cancellation", async () => {
  using _timers = fakeTimers();
  let complete: (result: RouterProbeResult) => void = () => {};
  const result = new Promise<RouterProbeResult>((resolve) => {
    complete = resolve;
  });
  const probe = vi.fn(() => result);
  const publish = vi.fn();
  const stop = superviseConnection({ probe, publish });
  await vi.advanceTimersByTimeAsync(300000);
  expect(probe).toHaveBeenCalledTimes(1);
  stop();
  complete({ kind: "connected", service: "router-api", identity: "Office", version: "6.49" });
  await result;
  await vi.advanceTimersByTimeAsync(300000);
  expect(probe).toHaveBeenCalledTimes(1);
  expect(publish).toHaveBeenCalledTimes(1);
});
