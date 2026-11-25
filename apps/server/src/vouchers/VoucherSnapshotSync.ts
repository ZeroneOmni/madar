// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  RouterDatabaseFailureReason,
  RouterDatabaseStage,
  VoucherFailure,
  type RouterDatabaseScope,
  type RouterDatabaseStatus,
  type RouterDatabaseTrigger,
  type VoucherScope,
} from "@madar/contracts";
import * as ServerConfig from "../config.ts";
import * as RouterApi from "../routers/RouterApi.ts";
import * as RouterSftp from "../routers/RouterSftp.ts";
import * as VoucherSnapshotReader from "./VoucherSnapshotReader.ts";
import * as VoucherStore from "./VoucherStore.ts";

export class CopyFailure extends Schema.TaggedError<CopyFailure>()("CopyFailure", {
  stage: RouterDatabaseStage,
  reason: RouterDatabaseFailureReason,
  offeredHostKey: Schema.optional(Schema.String),
}) {}
class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {}) {}

/** Timing of automatic copies. Manual copies skip the cooldown and the backoff. */
const SNAPSHOT_TIMING = {
  /** Refresh triggers inside this window share one copy. */
  coalesceSeconds: 60,
  /** At most one automatic copy per router in this period. */
  cooldownSeconds: 4 * 3600,
  /** Automatic copies wait this long after SSH was off or refused. */
  backoffSeconds: 24 * 3600,
  /** One retry of a transient failure. */
  retrySeconds: 60,
} as const;

/** Failures the operator must fix; automatic copies stop until then. */
const pausing = new Set<CopyFailure["reason"]>(["authentication", "host-key", "schema"]);
/** SSH is off or the account lacks a right: try automatically again a day later. */
const backingOff = new Set<CopyFailure["reason"]>(["ssh-off", "permission"]);
const retrying = new Set<CopyFailure["reason"]>([
  "network",
  "timeout",
  "stalled",
  "changed",
  "corrupt",
]);
const HEADER = "SQLite format 3\u0000";
const emptyState: VoucherStore.DatabaseState = {
  lastAttemptAt: null,
  lastAutomaticAt: null,
  lastOutcome: null,
  acceptedAt: null,
  fingerprint: null,
  failureStage: null,
  failureReason: null,
  failedAt: null,
  paused: false,
  retryAt: null,
  hostKey: null,
  offeredHostKey: null,
};
const isStage = Schema.is(RouterDatabaseStage);
const isReason = Schema.is(RouterDatabaseFailureReason);

interface Job {
  readonly trigger: RouterDatabaseTrigger;
  readonly startedAt: string;
  readonly cancel: Deferred.Deferred<void>;
  readonly done: Deferred.Deferred<void>;
  stage: RouterDatabaseStage;
  received: number;
  total: number | null;
}
interface Live {
  job: Job | null;
  scheduled: { readonly at: string; readonly fiber: Fiber.Fiber<void> } | null;
  /** Whether this process has seen a refresh of the router; the first one only sets the baseline. */
  seen: boolean;
  unexplained: number;
}

export class VoucherSnapshotSync extends Context.Service<
  VoucherSnapshotSync,
  {
    /** Called after each successful refresh; decides whether an automatic copy is due. */
    readonly observe: (
      scope: VoucherScope,
      owner: string,
      signals: VoucherStore.RefreshSignals,
    ) => Effect.Effect<void>;
    /** Starts a manual copy, or returns the one already running. */
    readonly start: (
      scope: RouterDatabaseScope,
      owner: string,
    ) => Effect.Effect<RouterDatabaseStatus, VoucherFailure>;
    readonly cancel: (
      scope: RouterDatabaseScope,
    ) => Effect.Effect<RouterDatabaseStatus, VoucherFailure>;
    readonly status: (
      scope: RouterDatabaseScope,
    ) => Effect.Effect<RouterDatabaseStatus, VoucherFailure>;
    /** Waits for a scheduled or running copy of this router to finish. */
    readonly settled: (
      scope: RouterDatabaseScope,
    ) => Effect.Effect<RouterDatabaseStatus, VoucherFailure>;
    /** Trusts the SSH host key the router offered after a host-key failure. */
    readonly trust: (
      scope: RouterDatabaseScope,
      hostKey: string,
    ) => Effect.Effect<RouterDatabaseStatus, VoucherFailure>;
  }
>()("madar/vouchers/VoucherSnapshotSync") {}

const make = Effect.gen(function* () {
  const api = yield* RouterApi.RouterApi;
  const sftp = yield* RouterSftp.RouterSftp;
  const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
  const store = yield* VoucherStore.VoucherStore;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const layerScope = yield* Effect.scope;
  const transfers = yield* Semaphore.make(1);
  const directory = path.join(config.stateDir, "router-copies");
  // Copies left by a crash or a forced quit are never reused.
  yield* fs.remove(directory, { recursive: true }).pipe(Effect.ignore);
  yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.ignore);

  const lives = new Map<string, Live>();
  const liveFor = (key: string) => {
    let live = lives.get(key);
    if (!live) {
      live = { job: null, scheduled: null, seen: false, unexplained: 0 };
      lives.set(key, live);
    }
    return live;
  };
  const isoAt = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
  const now = Clock.currentTimeMillis;

  const copy = Effect.fn("VoucherSnapshotSync.copy")(function* (
    target: RouterDatabaseScope,
    owner: string,
    job: Job,
    state: VoucherStore.DatabaseState,
    save: (state: VoucherStore.DatabaseState) => Effect.Effect<void, VoucherFailure>,
  ) {
    const key = RouterApi.routerKey(target.router);
    const fail = (stage: CopyFailure["stage"], reason: CopyFailure["reason"]) =>
      new CopyFailure({ stage, reason });
    const apiRead = (words: readonly string[]) =>
      api
        .execute(target.router, owner, words)
        .pipe(
          Effect.mapError((error) =>
            fail("connect", error.reason === "disconnected" ? "disconnected" : "network"),
          ),
        );
    const password = yield* api
      .password(target.router, owner)
      .pipe(Effect.mapError(() => fail("connect", "disconnected")));
    const service = yield* apiRead([
      "/ip/service/print",
      "=.proplist=name,port,disabled",
      "?name=ssh",
    ]).pipe(Effect.orElseSucceed(() => []));
    if (service[0]?.disabled === "true") return yield* fail("connect", "ssh-off");
    const port = Number(service[0]?.port) || 22;
    const database = yield* apiRead([
      "/tool/user-manager/database/print",
      "=.proplist=db-path",
    ]).pipe(Effect.orElseSucceed(() => []));
    const folder = (database[0]?.["db-path"] ?? "").replace(/^\/+|\/+$/g, "") || "user-manager";
    const file = `${folder}/sqldb`;
    const journal = `${folder}/sqldb-journal`;
    const temp = path.join(directory, `${NodeCrypto.randomUUID()}.sqlite`);

    return yield* Effect.gen(function* () {
      const outcome = yield* Effect.gen(function* () {
        const mapSftp = (stage: CopyFailure["stage"]) =>
          Effect.mapError((error: RouterSftp.RouterSftpError) =>
            error.reason === "host-key"
              ? new CopyFailure({
                  stage: "connect",
                  reason: "host-key",
                  ...(error.offeredHostKey ? { offeredHostKey: error.offeredHostKey } : {}),
                })
              : fail(stage, error.reason),
          );
        const session = yield* sftp
          .connect({
            host: target.router.host,
            port,
            username: target.router.username,
            password,
            hostKey: state.hostKey,
          })
          .pipe(mapSftp("connect"));
        // First use pins the router's key; a later change fails until the operator trusts it.
        if (state.hostKey === null) yield* save({ ...state, hostKey: session.hostKey });
        const inspect = Effect.fnUntraced(function* (stage: CopyFailure["stage"]) {
          const info = yield* session.stat(file).pipe(mapSftp(stage));
          if (!info) return yield* fail(stage, "not-found");
          if ((yield* session.stat(journal).pipe(mapSftp(stage))) !== null)
            return yield* fail(stage, "changed");
          const head = yield* session.head(file, 100).pipe(mapSftp(stage));
          if (Buffer.from(head.subarray(0, HEADER.length)).toString("latin1") !== HEADER)
            return yield* fail(stage, "corrupt");
          const digest = NodeCrypto.createHash("sha256").update(head).digest("hex").slice(0, 32);
          return { size: info.size, fingerprint: `${info.size}:${info.mtime}:${digest}` };
        });
        job.stage = "check";
        const before = yield* inspect("check");
        if (job.trigger === "automatic" && before.fingerprint === state.fingerprint)
          return { kind: "unchanged" as const, fingerprint: before.fingerprint };
        if (before.size > RouterSftp.SFTP_LIMITS.maxBytes) return yield* fail("check", "too-large");
        job.stage = "download";
        job.total = before.size;
        const received = yield* session
          .download(file, temp, {
            bytesPerSecond:
              job.trigger === "manual" ? null : RouterSftp.SFTP_LIMITS.automaticBytesPerSecond,
            onProgress: (count, total) =>
              Effect.sync(() => {
                job.received = count;
                job.total = total;
              }),
          })
          .pipe(mapSftp("download"));
        job.stage = "verify";
        const after = yield* inspect("verify");
        if (after.fingerprint !== before.fingerprint || received !== before.size)
          return yield* fail("verify", "changed");
        return { kind: "copied" as const, fingerprint: before.fingerprint };
      }).pipe(Effect.scoped);
      if (outcome.kind === "unchanged") return outcome;
      job.stage = "read";
      const contents = yield* reader
        .read(temp)
        .pipe(Effect.mapError((error) => fail("read", error.reason)));
      job.stage = "save";
      const capturedAt = isoAt(yield* now);
      const published = yield* store
        .publishSnapshot(key, { capturedAt, fingerprint: outcome.fingerprint }, contents)
        .pipe(Effect.mapError(() => fail("save", "storage")));
      yield* Effect.logInfo("Router database copy published", {
        users: contents.users.length,
        skipped: contents.skipped,
        customers: published.length,
        matched: published.reduce((sum, item) => sum + item.matched, 0),
      });
      return { kind: "accepted" as const, fingerprint: outcome.fingerprint, capturedAt };
    }).pipe(Effect.ensuring(fs.remove(temp, { force: true }).pipe(Effect.ignore)));
  });

  /** One copy attempt: records its outcome and schedules the single retry. */
  const run: (
    target: RouterDatabaseScope,
    owner: string,
    job: Job,
    retry: boolean,
  ) => Effect.Effect<void> = Effect.fn("VoucherSnapshotSync.run")(
    function* (target: RouterDatabaseScope, owner: string, job: Job, retry: boolean) {
      const key = RouterApi.routerKey(target.router);
      const live = liveFor(key);
      let state = (yield* store.databaseState(key)) ?? emptyState;
      const save = (next: VoucherStore.DatabaseState) =>
        Effect.tap(store.saveDatabaseState(key, next), () =>
          Effect.sync(() => {
            state = next;
          }),
        );
      yield* save({
        ...state,
        lastAttemptAt: job.startedAt,
        lastAutomaticAt: job.trigger === "manual" ? state.lastAutomaticAt : job.startedAt,
      });
      const result = yield* transfers
        .withPermits(1)(copy(target, owner, job, state, save))
        .pipe(
          Effect.raceFirst(
            Deferred.await(job.cancel).pipe(Effect.andThen(Effect.fail(new Cancelled()))),
          ),
          Effect.result,
        );
      const checkedAt = isoAt(yield* now);
      if (result._tag === "Success") {
        const value = result.success;
        yield* save({
          ...state,
          lastOutcome: value.kind,
          ...(value.kind === "accepted"
            ? { acceptedAt: value.capturedAt, fingerprint: value.fingerprint }
            : {}),
          failureStage: null,
          failureReason: null,
          failedAt: null,
          paused: false,
          retryAt: null,
          offeredHostKey: null,
        });
        // An unchanged file holds the same data, so the accepted copy is confirmed as of now.
        if (value.kind === "unchanged")
          yield* store.recordAttempt(key, {
            outcome: "unchanged",
            checkedAt,
            stage: null,
            reason: null,
            fingerprint: value.fingerprint,
          });
        return;
      }
      const error = result.failure;
      if (error._tag === "Cancelled") {
        yield* save({ ...state, lastOutcome: "cancelled" });
        yield* store.recordAttempt(key, {
          outcome: "cancelled",
          checkedAt,
          stage: null,
          reason: null,
        });
        return;
      }
      const failure =
        error._tag === "CopyFailure"
          ? error
          : new CopyFailure({ stage: "save", reason: "storage" });
      const millis = yield* now;
      yield* save({
        ...state,
        lastOutcome: "failed",
        failureStage: failure.stage,
        failureReason: failure.reason,
        failedAt: checkedAt,
        paused: pausing.has(failure.reason),
        retryAt: backingOff.has(failure.reason)
          ? isoAt(millis + SNAPSHOT_TIMING.backoffSeconds * 1000)
          : null,
        offeredHostKey: failure.offeredHostKey ?? null,
      });
      yield* store.recordAttempt(key, {
        outcome: "failed",
        checkedAt,
        stage: failure.stage,
        reason: failure.reason,
      });
      yield* Effect.logWarning("Router database copy failed", {
        stage: failure.stage,
        reason: failure.reason,
      });
      if (!retry && retrying.has(failure.reason) && live.scheduled === null) {
        const at = millis + SNAPSHOT_TIMING.retrySeconds * 1000;
        const fiber = yield* Effect.sleep(`${SNAPSHOT_TIMING.retrySeconds} seconds`).pipe(
          Effect.andThen(
            Effect.suspend(() => {
              live.scheduled = null;
              return begin(target, owner, job.trigger, true);
            }),
          ),
          Effect.forkIn(layerScope),
        );
        live.scheduled = { at: isoAt(at), fiber };
      }
    },
    Effect.catch(() => Effect.logWarning("Router database copy state could not be saved")),
  );

  const begin = Effect.fnUntraced(function* (
    target: RouterDatabaseScope,
    owner: string,
    trigger: RouterDatabaseTrigger,
    retry = false,
  ) {
    const live = liveFor(RouterApi.routerKey(target.router));
    if (live.job) return;
    const job: Job = {
      trigger,
      startedAt: isoAt(yield* now),
      cancel: yield* Deferred.make<void>(),
      done: yield* Deferred.make<void>(),
      stage: "connect",
      received: 0,
      total: null,
    };
    live.job = job;
    yield* run(target, owner, job, retry).pipe(
      Effect.ensuring(
        Effect.suspend(() => {
          if (live.job === job) live.job = null;
          return Deferred.succeed(job.done, undefined);
        }),
      ),
      Effect.forkIn(layerScope),
    );
  });

  /** An automatic copy runs only when not paused, not backing off and past the cooldown. */
  const automatic = Effect.fn("VoucherSnapshotSync.automatic")(function* (
    target: RouterDatabaseScope,
    owner: string,
  ) {
    const state = yield* store.databaseState(RouterApi.routerKey(target.router));
    const millis = yield* now;
    if (state?.paused) return;
    if (state?.retryAt && Date.parse(state.retryAt) > millis) return;
    if (
      state?.lastAutomaticAt &&
      Date.parse(state.lastAutomaticAt) + SNAPSHOT_TIMING.cooldownSeconds * 1000 > millis
    )
      return;
    yield* begin(target, owner, "automatic");
  });

  const observe = Effect.fn("VoucherSnapshotSync.observe")(
    function* (target: RouterDatabaseScope, owner: string, signals: VoucherStore.RefreshSignals) {
      const key = RouterApi.routerKey(target.router);
      const live = liveFor(key);
      if (!live.seen) {
        live.seen = true;
        live.unexplained = signals.unexplained;
        // Never at startup: only a router Madar has never copied from starts right away.
        if ((yield* store.databaseState(key)) === null) yield* begin(target, owner, "first");
        return;
      }
      const triggered =
        signals.newUsed > 0 ||
        signals.profileChanged > 0 ||
        signals.counterDropped > 0 ||
        signals.unexplained > live.unexplained;
      live.unexplained = signals.unexplained;
      if (!triggered || live.job || live.scheduled) return;
      const at = (yield* now) + SNAPSHOT_TIMING.coalesceSeconds * 1000;
      const fiber = yield* Effect.sleep(`${SNAPSHOT_TIMING.coalesceSeconds} seconds`).pipe(
        Effect.andThen(
          Effect.suspend(() => {
            live.scheduled = null;
            return automatic(target, owner);
          }),
        ),
        Effect.ignore,
        Effect.forkIn(layerScope),
      );
      live.scheduled = { at: isoAt(at), fiber };
    },
    (effect) => Effect.ignore(effect),
  );

  const status = Effect.fn("VoucherSnapshotSync.status")(function* (target: RouterDatabaseScope) {
    const key = RouterApi.routerKey(target.router);
    const live = liveFor(key);
    const state = yield* store.databaseState(key);
    const customer = target.customer;
    const capture = customer ? yield* store.capture({ router: target.router, customer }) : null;
    const job = live.job;
    return {
      job: job && {
        trigger: job.trigger,
        stage: job.stage,
        received: job.received,
        total: job.total,
        startedAt: job.startedAt,
      },
      scheduledAt: live.scheduled?.at ?? null,
      capturedAt: customer ? (capture?.capturedAt ?? null) : (state?.acceptedAt ?? null),
      checkedAt: capture?.checkedAt ?? state?.lastAttemptAt ?? null,
      // Before the customer list is known there is no per-customer record yet.
      outcome: capture?.outcome ?? state?.lastOutcome ?? "none",
      failure:
        state && isStage(state.failureStage) && isReason(state.failureReason)
          ? { stage: state.failureStage, reason: state.failureReason }
          : null,
      paused: state?.paused ?? false,
      retryAt: state?.retryAt ?? null,
      hostKey: state?.hostKey ?? null,
      offeredHostKey: state?.offeredHostKey ?? null,
    } satisfies RouterDatabaseStatus;
  });

  const start = Effect.fn("VoucherSnapshotSync.start")(function* (
    target: RouterDatabaseScope,
    owner: string,
  ) {
    yield* begin(target, owner, "manual");
    return yield* status(target);
  });

  const cancel = Effect.fn("VoucherSnapshotSync.cancel")(function* (target: RouterDatabaseScope) {
    const live = liveFor(RouterApi.routerKey(target.router));
    if (live.job) yield* Deferred.succeed(live.job.cancel, undefined);
    if (live.scheduled) {
      yield* Fiber.interrupt(live.scheduled.fiber);
      live.scheduled = null;
    }
    return yield* status(target);
  });

  const settled = Effect.fn("VoucherSnapshotSync.settled")(function* (target: RouterDatabaseScope) {
    const live = liveFor(RouterApi.routerKey(target.router));
    if (live.scheduled) yield* Fiber.await(live.scheduled.fiber);
    if (live.job) yield* Deferred.await(live.job.done);
    return yield* status(target);
  });

  const trust = Effect.fn("VoucherSnapshotSync.trust")(function* (
    target: RouterDatabaseScope,
    hostKey: string,
  ) {
    const key = RouterApi.routerKey(target.router);
    const state = yield* store.databaseState(key);
    if (!state || state.offeredHostKey !== hostKey)
      return yield* new VoucherFailure({ reason: "conflict" });
    yield* store.saveDatabaseState(key, {
      ...state,
      hostKey,
      offeredHostKey: null,
      paused: false,
      failureStage: null,
      failureReason: null,
    });
    return yield* status(target);
  });

  return VoucherSnapshotSync.of({ observe, start, cancel, status, settled, trust });
});

export const layer = Layer.effect(VoucherSnapshotSync, make);
