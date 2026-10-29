import { describe, expect, it } from "vite-plus/test";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { ORCHESTRATION_V2_WS_METHODS } from "./orchestrationV2.ts";
import { WS_METHODS, WsRpcGroup } from "./rpc.ts";

describe("WebSocket RPC contracts", () => {
  it("rejects server-internal commands sent to dispatchCommand", () => {
    const dispatchCommand = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
    if (dispatchCommand === undefined) throw new Error("dispatchCommand is not registered");
    const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);

    expect(
      Exit.isFailure(
        decode({
          type: "checkpoint.rollback.fail",
          commandId: "forged-rollback-failure",
          threadId: "thread-1",
          requestId: "rollback-1",
          message: "Forged failure.",
        }),
      ),
    ).toBe(true);
    expect(
      Exit.isSuccess(
        decode({
          type: "checkpoint.rollback",
          commandId: "rollback-1",
          threadId: "thread-1",
          scopeId: "scope-1",
          checkpointId: "checkpoint-1",
        }),
      ),
    ).toBe(true);
  });

  it("lets the server pick a new worktree's folder", () => {
    const createWorktree = WsRpcGroup.requests.get(WS_METHODS.vcsCreateWorktree);
    if (createWorktree === undefined) throw new Error("vcs.createWorktree is not registered");
    const decode = Schema.decodeUnknownExit(createWorktree.payloadSchema);
    const request = { cwd: "/repo", refName: "main", newRefName: "feature/x" };

    expect(Exit.isSuccess(decode({ ...request, path: null }))).toBe(true);
    expect(Exit.isFailure(decode({ ...request, path: "/repo/.git/hooks" }))).toBe(true);
  });
});

it.each([
  "device.list",
  "device.open",
  "subscribeDeviceState",
  "guestShare.create",
  "cloud.getRelayClientStatus",
  "cloud.installRelayClient",
  "scheduledTasks.upsert",
  "mcpApps.callTool",
])("does not expose the removed %s RPC", (method) => {
  expect([...WsRpcGroup.requests.keys()]).not.toContain(method);
});

it.each([
  {
    type: "delegated_task.wake-policy",
    commandId: "wake",
    parentThreadId: "parent",
    taskId: "task",
    completionWake: "always",
  },
  {
    type: "delegated_task.completion-delivery.acknowledge",
    commandId: "ack",
    parentThreadId: "parent",
    taskId: "task",
    observedByRunId: null,
  },
  { type: "thread.guest-share.close", commandId: "close", threadId: "thread" },
  {
    type: "thread.guest-message.dismiss",
    commandId: "dismiss",
    threadId: "thread",
    guestMessageId: "message",
  },
])("rejects retired $type commands over WebSocket", (command) => {
  const rpc = WsRpcGroup.requests.get(ORCHESTRATION_V2_WS_METHODS.dispatchCommand);
  if (rpc === undefined) throw new Error("dispatchCommand is not registered");
  expect(Exit.isFailure(Schema.decodeUnknownExit(rpc.payloadSchema)(command))).toBe(true);
});
