import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layerSql = ProjectionStore.layer.pipe(Layer.provideMerge(SqlitePersistence.layerMemory));
const now = DateTime.makeUnsafe("2026-09-04T12:00:00Z");
const old = DateTime.subtract(now, { days: 10 });
const providerInstanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId: providerInstanceId, model: "test-model" };

const createThread = Effect.fn(function* (
  name: string,
  overrides: Partial<OrchestrationV2AppThread> = {},
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const threadId = ThreadId.make(`thread:settlement:${name}`);
  const thread: OrchestrationV2AppThread = {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project:settlement"),
    title: name,
    providerInstanceId,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feature",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: old,
    updatedAt: old,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    ...overrides,
  };
  yield* store.apply({
    id: EventId.make(`event:${threadId}`),
    type: "thread.created",
    threadId,
    occurredAt: old,
    payload: thread,
  });
  return threadId;
});

const createRun = Effect.fn(function* (
  threadId: ThreadId,
  status: OrchestrationV2Run["status"] = "completed",
  ordinal = 1,
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const runId = RunId.make(`run:${threadId}:${ordinal}`);
  yield* store.apply({
    id: EventId.make(`event:${runId}`),
    type: "run.created",
    threadId,
    occurredAt: old,
    payload: {
      id: runId,
      threadId,
      ordinal,
      providerInstanceId,
      modelSelection,
      providerThreadId: null,
      userMessageId: MessageId.make(`message:${runId}`),
      rootNodeId: null,
      activeAttemptId: null,
      status,
      requestedAt: old,
      startedAt: status === "queued" ? null : old,
      completedAt: ["completed", "rolled_back", "failed"].includes(status) ? old : null,
      checkpointId: null,
      contextHandoffId: null,
    },
  });
  return runId;
});

it.effect.each([
  ["sql", layerSql],
  ["memory", ProjectionStore.layerMemory],
] as const)("%s: the user-authored message time ignores agent notifications", ([, testLayer]) =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* createThread("agent-woken");
    yield* createRun(threadId);
    const message = (
      id: string,
      createdBy: "user" | "agent",
      creationSource: "web" | "provider",
      at: DateTime.Utc,
    ) =>
      store.apply({
        id: EventId.make(`event:settlement:${id}`),
        type: "message.updated",
        threadId,
        occurredAt: at,
        payload: {
          createdBy,
          creationSource,
          id: MessageId.make(`message:settlement:${id}`),
          threadId,
          runId: null,
          nodeId: null,
          role: "user",
          text: id,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        },
      });
    const written = DateTime.subtract(now, { hours: 2 });
    yield* message("written", "user", "web", written);
    yield* message("notification", "agent", "provider", now);

    const [candidate] = yield* store.getSettlementCandidates(threadId);
    assert.isDefined(candidate);
    assert.equal(DateTime.formatIso(candidate.latestUserMessageAt!), DateTime.formatIso(now));
    assert.equal(
      DateTime.formatIso(candidate.latestUserAuthoredMessageAt!),
      DateTime.formatIso(written),
    );
    const shellThread = (yield* store.getShellSnapshot()).threads.find(
      (thread) => thread.id === threadId,
    );
    assert.equal(
      DateTime.formatIso(shellThread!.latestUserAuthoredMessageAt!),
      DateTime.formatIso(written),
    );
  }).pipe(Effect.provide(testLayer)),
);

const pullRequestLink = (number: number) => ({
  host: "github.com",
  repository: "owner/repository",
  number,
  url: `https://github.com/owner/repository/pull/${number}`,
  source: "manual" as const,
  linkedAt: DateTime.formatIso(old),
  snapshot: null,
  stack: null,
});

it.effect.each([
  ["sql", layerSql],
  ["memory", ProjectionStore.layerMemory],
] as const)(
  "%s: lists only active threads with pull request links, oldest first",
  ([, testLayer]) =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      yield* createThread("no-links");
      yield* createThread("empty-links", { pullRequests: [] });
      yield* createThread("archived-link", {
        archivedAt: old,
        pullRequests: [pullRequestLink(1)],
      });
      const settled = yield* createThread("settled-link", {
        settledOverride: "settled",
        settledAt: old,
        updatedAt: DateTime.subtract(now, { days: 12 }),
        pullRequests: [pullRequestLink(2)],
      });
      const open = yield* createThread("open-link", {
        pullRequests: [pullRequestLink(3), pullRequestLink(4)],
      });

      const threads = yield* store.getThreadsWithPullRequests();
      assert.deepEqual(
        threads.map((thread) => [thread.id, thread.settledOverride, thread.pullRequests?.length]),
        [
          [settled, "settled", 1],
          [open, null, 2],
        ],
      );
      assert.deepEqual(
        (yield* store.getThreadsWithPullRequests(open)).map((thread) => thread.id),
        [open],
      );
    }).pipe(Effect.provide(testLayer)),
);

it.effect.each([
  ["sql", layerSql],
  ["memory", ProjectionStore.layerMemory],
] as const)("%s: an unsettled-only shell read skips settled threads", ([, testLayer]) =>
  Effect.gen(function* () {
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const open = yield* createThread("unsettled-open");
    const reopened = yield* createThread("unsettled-reopened", { settledOverride: "active" });
    yield* createThread("unsettled-manual", { settledOverride: "settled", settledAt: old });
    yield* createThread("unsettled-auto", { settledAt: old });
    yield* createThread("unsettled-archived", { archivedAt: old });

    const shell = yield* store.getShellSnapshot({ location: "active", unsettledOnly: true });
    assert.deepEqual(new Set(shell.threads.map((thread) => thread.id)), new Set([open, reopened]));
    assert.equal(shell.archivedThreads.length, 0);
    const all = yield* store.getShellSnapshot({ location: "active" });
    assert.equal(all.threads.length, 4);
  }).pipe(Effect.provide(testLayer)),
);
