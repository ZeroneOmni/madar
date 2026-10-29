import {
  type EnvironmentId,
  type ServerConfig,
  type ServerConfigStreamEvent,
  type ServerLifecycleWelcomePayload,
  type ServerLifecycleStreamReadyEvent,
  type ServerSelfUpdateProgressEvent,
  type ServerSelfUpdateResult,
  WS_METHODS,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import { safeErrorLogAttributes } from "../errors/safeLog.ts";
import * as Persistence from "../platform/persistence.ts";
import { runCachePersistence } from "./cachePersistence.ts";
import {
  isRpcClientError,
  subscribe,
  subscribeDynamicWithSession,
  type EnvironmentRpcInput,
} from "../rpc/client.ts";
import type { RpcSession } from "../rpc/session.ts";
import {
  applyServerConfigProjection,
  type ServerConfigProjection,
  withoutEnvironmentThemes,
} from "./serverConfigProjection.ts";

export type { ServerConfigProjection } from "./serverConfigProjection.ts";

export type ServerUpdateStage = "downloading" | "installing" | "resuming";

export type ServerUpdateState =
  | { readonly status: "idle" }
  | {
      readonly status: "running";
      readonly stage: ServerUpdateStage;
      readonly fromVersion: string;
      readonly targetVersion: string;
    }
  | {
      readonly status: "failed";
      readonly stage: ServerUpdateStage;
      readonly fromVersion: string;
      readonly targetVersion: string;
      readonly message: string;
    };

export interface ServerUpdateTarget {
  readonly environmentId: EnvironmentId;
  readonly input: EnvironmentRpcInput<typeof WS_METHODS.serverUpdateServer>;
}

const IDLE_SERVER_UPDATE_STATE: ServerUpdateState = { status: "idle" };

export class ServerUpdateResumeTimeoutError extends Schema.TaggedError<ServerUpdateResumeTimeoutError>()(
  "ServerUpdateResumeTimeoutError",
  {
    environmentId: Schema.String,
    targetVersion: Schema.String,
  },
) {
  override get message(): string {
    return `The server did not resume on t3@${this.targetVersion}.`;
  }
}

export class ServerUpdateProgressIncompleteError extends Schema.TaggedError<ServerUpdateProgressIncompleteError>()(
  "ServerUpdateProgressIncompleteError",
  {
    targetVersion: Schema.String,
  },
) {
  override get message(): string {
    return `The t3@${this.targetVersion} update ended before the server accepted the restart.`;
  }
}

export class ServerUpdateTerminalError extends Schema.TaggedError<ServerUpdateTerminalError>()(
  "ServerUpdateTerminalError",
  {
    targetVersion: Schema.String,
    status: Schema.Literals(["committed", "rolled-back", "failed"]),
    reason: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return this.reason ?? `The t3@${this.targetVersion} update ${this.status}.`;
  }
}

// Covers the service launcher's 30-minute trial deadline (PREPARED_TIMEOUT_MS)
// and a final restart of the previous version when the trial rolls back.
const SERVER_UPDATE_RESUME_TIMEOUT = Duration.minutes(32);

export function matchesServerUpdateReadyEvent(
  result: ServerSelfUpdateResult,
  event: ServerLifecycleStreamReadyEvent,
): boolean {
  return result.updateId === undefined
    ? event.payload.environment.serverVersion === result.targetVersion
    : event.payload.updateOutcome?.id === result.updateId;
}

export function matchesServerUpdateResumeEvent(
  result: ServerSelfUpdateResult,
  event: ServerLifecycleStreamReadyEvent,
): boolean {
  return (
    (result.method === "desktop-app" && result.desktopUpdateToken !== undefined) ||
    matchesServerUpdateReadyEvent(result, event)
  );
}

export function validateServerUpdateReadyEvent(
  result: ServerSelfUpdateResult,
  event: ServerLifecycleStreamReadyEvent,
): Effect.Effect<void, ServerUpdateTerminalError> {
  if (result.updateId === undefined) return Effect.void;
  const outcome = event.payload.updateOutcome;
  if (
    outcome?.id === result.updateId &&
    outcome.status === "committed" &&
    outcome.targetVersion === result.targetVersion &&
    event.payload.environment.serverVersion === result.targetVersion
  ) {
    return Effect.void;
  }
  return Effect.fail(
    new ServerUpdateTerminalError({
      targetVersion: result.targetVersion,
      status: outcome?.status ?? "failed",
      reason:
        outcome?.reason ??
        "The service launcher resumed without committing the requested server version.",
    }),
  );
}

/**
 * The sleep before each nudge is the pacer: a connection that fails instantly
 * re-enters backoff immediately and would otherwise spin a tight retry loop.
 *
 * Callers fork this as a child of the update command so it is interrupted as
 * soon as the update settles, whether it succeeds, fails, or times out.
 */
export function nudgeReconnectDuringUpdateRestart(input: {
  readonly stateChanges: Stream.Stream<
    {
      readonly phase: string;
      readonly lastFailure?: { readonly reason: string } | null;
    },
    unknown
  >;
  readonly retryNow: Effect.Effect<void>;
  readonly interval?: Duration.Duration;
}): Effect.Effect<void> {
  return input.stateChanges.pipe(
    Stream.filter(
      (state) =>
        state.phase === "backoff" ||
        (state.phase === "blocked" && state.lastFailure?.reason === "authentication"),
    ),
    Stream.runForEach(() =>
      Effect.sleep(input.interval ?? Duration.seconds(1)).pipe(Effect.andThen(input.retryNow)),
    ),
    Effect.timeoutOption(SERVER_UPDATE_RESUME_TIMEOUT),
    Effect.ignore,
  );
}

export function waitForNextEnvironmentReconnect<E>(
  stateChanges: Stream.Stream<{ readonly phase: string }, E>,
): Effect.Effect<void, E> {
  return stateChanges.pipe(
    Stream.dropWhile((state) => state.phase === "connected"),
    Stream.filter((state) => state.phase === "connected"),
    Stream.runHead,
    Effect.asVoid,
  );
}

export const runDesktopCommitWithReconnectObserver = Effect.fn(
  "runDesktopCommitWithReconnectObserver",
)(function* <EState, ECommit>(
  stateChanges: Stream.Stream<{ readonly phase: string }, EState>,
  commit: Effect.Effect<void, ECommit>,
) {
  const armed = yield* Deferred.make<void>();
  const reconnected = yield* Deferred.make<void>();
  const observer = yield* stateChanges.pipe(
    Stream.tap(() => Deferred.succeed(armed, undefined)),
    waitForNextEnvironmentReconnect,
    Effect.andThen(Deferred.succeed(reconnected, undefined)),
    Effect.forkChild,
  );
  yield* Deferred.await(armed);
  const commitExit = yield* commit.pipe(Effect.exit);
  if (Exit.isSuccess(commitExit)) {
    yield* Fiber.interrupt(observer);
    return;
  }
  if (!isLegacyUpdateHandoffLoss(commitExit.cause)) {
    yield* Fiber.interrupt(observer);
    return yield* Effect.failCause(commitExit.cause);
  }
  yield* Deferred.await(reconnected).pipe(Effect.timeout(SERVER_UPDATE_RESUME_TIMEOUT));
  return yield* Effect.failCause(commitExit.cause);
});

export const waitForDesktopUpdateTarget = Effect.fn("waitForDesktopUpdateTarget")(function* <
  EReady,
  ECommit,
>(
  targetVersion: string,
  nextReady: Effect.Effect<ServerLifecycleStreamReadyEvent, EReady>,
  retryCommit: Effect.Effect<void, ECommit>,
  maxCommitAttempts = 3,
): Effect.fn.Return<ServerLifecycleStreamReadyEvent, EReady | ECommit | ServerUpdateTerminalError> {
  for (let attempt = 1; attempt <= maxCommitAttempts; attempt += 1) {
    const ready = yield* nextReady;
    if (ready.payload.environment.serverVersion === targetVersion) return ready;
    if (attempt === maxCommitAttempts) break;
    const retryExit = yield* retryCommit.pipe(Effect.exit);
    if (Exit.isSuccess(retryExit)) break;
    if (!isLegacyUpdateHandoffLoss(retryExit.cause)) {
      return yield* Effect.failCause(retryExit.cause);
    }
  }
  return yield* new ServerUpdateTerminalError({
    targetVersion,
    status: "failed",
    reason: "The desktop app resumed without installing the prepared update.",
  });
});

export function serverUpdateStateForProgressEvent(
  fromVersion: string,
  targetVersion: string,
  event: ServerSelfUpdateProgressEvent,
): Extract<ServerUpdateState, { status: "running" }> {
  return {
    status: "running",
    stage:
      event.type !== "complete"
        ? event.stage
        : event.result.method === "desktop-app" && event.result.desktopUpdateToken !== undefined
          ? "installing"
          : "resuming",
    fromVersion,
    targetVersion,
  };
}

export function serverUpdateStateForServerVersion(
  state: ServerUpdateState,
  serverVersion: string | null,
): ServerUpdateState {
  return state.status === "idle" ||
    state.status === "running" ||
    serverVersion === null ||
    state.fromVersion === serverVersion
    ? state
    : IDLE_SERVER_UPDATE_STATE;
}

function isRpcSocketError(error: unknown): boolean {
  if (!isRpcClientError(error)) {
    return false;
  }
  switch (error.reason._tag) {
    case "SocketReadError":
    case "SocketWriteError":
    case "SocketCloseError":
      return true;
    default:
      return false;
  }
}

export function isLegacyUpdateHandoffLoss(cause: Cause.Cause<unknown>): boolean {
  if (Cause.hasInterruptsOnly(cause)) {
    return true;
  }
  return (
    cause.reasons.length > 0 &&
    cause.reasons.every((reason) => Cause.isFailReason(reason) && isRpcSocketError(reason.error))
  );
}

export function resolveServerUpdateProgressResult<E>(
  targetVersion: string,
  terminal: Option.Option<ServerSelfUpdateResult>,
  streamExit: Exit.Exit<void, E>,
): Effect.Effect<ServerSelfUpdateResult, E | ServerUpdateProgressIncompleteError> {
  if (
    Option.isSome(terminal) &&
    (Exit.isSuccess(streamExit) || isLegacyUpdateHandoffLoss(streamExit.cause))
  ) {
    return Effect.succeed(terminal.value);
  }
  if (Exit.isFailure(streamExit)) {
    return Effect.failCause(streamExit.cause);
  }
  return Effect.fail(new ServerUpdateProgressIncompleteError({ targetVersion }));
}

const cachedConfigSnapshotEvent = (config: ServerConfig): ServerConfigStreamEvent => ({
  version: 1,
  type: "snapshot",
  config,
});

export interface ServerConfigSubscriptionOptions {
  readonly environmentThemes?: boolean;
  readonly usageLimitSources?: boolean;
  readonly usageLimitsCommand?: boolean;
}

// Configs are JSON-shaped. Missing and undefined object fields persist identically.
function sameCacheValue(previous: unknown, next: unknown): boolean {
  if (previous === next) return true;
  if (
    previous === null ||
    next === null ||
    typeof previous !== "object" ||
    typeof next !== "object"
  ) {
    return false;
  }
  if (Array.isArray(previous) || Array.isArray(next)) {
    if (!Array.isArray(previous) || !Array.isArray(next) || previous.length !== next.length) {
      return false;
    }
    for (let index = 0; index < previous.length; index += 1) {
      if (!sameCacheValue(previous[index], next[index])) return false;
    }
    return true;
  }
  if (
    Object.getPrototypeOf(previous) !== Object.prototype ||
    Object.getPrototypeOf(next) !== Object.prototype
  ) {
    return false;
  }
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  return (
    Object.keys(before).every((key) =>
      sameCacheValue(before[key], Object.hasOwn(after, key) ? after[key] : undefined),
    ) && Object.keys(after).every((key) => Object.hasOwn(before, key) || after[key] === undefined)
  );
}

export const makeEnvironmentServerConfigState = Effect.fn("EnvironmentServerConfigState.make")(
  function* (subscription: ServerConfigSubscriptionOptions) {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const cache = yield* Persistence.EnvironmentCacheStore;
    const environmentId = supervisor.target.environmentId;
    const cachedConfig = yield* cache.loadServerConfig(environmentId).pipe(
      Effect.catch((error) =>
        Effect.logWarning("Could not load cached server configuration.").pipe(
          Effect.annotateLogs({
            environmentId,
            ...safeErrorLogAttributes(error),
          }),
          Effect.as(Option.none<ServerConfig>()),
        ),
      ),
    );
    const state = yield* SubscriptionRef.make<Option.Option<ServerConfigProjection>>(
      Option.map(cachedConfig, (cached) => ({
        config: withoutEnvironmentThemes(cached),
        latestEvent: cachedConfigSnapshotEvent(withoutEnvironmentThemes(cached)),
        source: "cache" as const,
      })),
    );
    const persistence = yield* Queue.sliding<ServerConfig>(1);
    const pendingPersistence = yield* Ref.make<Option.Option<ServerConfig>>(Option.none());
    let lastPersisted: ServerConfig | undefined;

    const persist = Effect.fn("EnvironmentServerConfigState.persist")(function* (
      config: ServerConfig,
    ) {
      // A cached stall would read as a fresh freeze on the next launch.
      const {
        environmentThemes: _themes,
        usageLimitSources: _sources,
        lastEventLoopStall: _stall,
        ...cacheable
      } = config;
      if (lastPersisted !== undefined && sameCacheValue(lastPersisted, cacheable)) {
        return true;
      }
      const saved = yield* cache.saveServerConfig(environmentId, cacheable).pipe(
        Effect.as(true),
        Effect.catch((error) =>
          Effect.logWarning("Could not persist cached server configuration.").pipe(
            Effect.annotateLogs({
              environmentId,
              ...safeErrorLogAttributes(error),
            }),
            Effect.as(false),
          ),
        ),
      );
      if (saved) lastPersisted = cacheable;
      return saved;
    });

    const persistPending = Effect.fn("EnvironmentServerConfigState.persistPending")(function* (
      config: ServerConfig,
    ) {
      if (!(yield* persist(config))) {
        return;
      }
      yield* Ref.update(pendingPersistence, (pending) =>
        Option.isSome(pending) && pending.value === config ? Option.none() : pending,
      );
    });

    yield* Effect.addFinalizer(() =>
      Ref.get(pendingPersistence).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.void,
            onSome: (config) => persist(config).pipe(Effect.asVoid),
          }),
        ),
      ),
    );

    yield* runCachePersistence(persistence, persistPending).pipe(Effect.forkScoped);

    yield* subscribe(WS_METHODS.subscribeServerConfig, {
      ...(subscription.environmentThemes === true ? { environmentThemes: true } : {}),
      ...(subscription.usageLimitSources === true ? { usageLimitSources: true } : {}),
      ...(subscription.usageLimitsCommand === true ? { usageLimitsCommand: true } : {}),
    }).pipe(
      Stream.runForEach((event) =>
        Effect.gen(function* () {
          const next = applyServerConfigProjection(yield* SubscriptionRef.get(state), event);
          if (Option.isNone(next)) {
            return;
          }
          yield* Ref.set(pendingPersistence, Option.some(next.value.config));
          yield* SubscriptionRef.set(state, next);
          yield* Queue.offer(persistence, next.value.config);
        }),
      ),
      Effect.forkScoped,
    );

    return state;
  },
);

export function applyServerWelcomeEvent(
  current: EnvironmentServerWelcomeState,
  session: RpcSession,
  event: {
    readonly type: "welcome" | "ready" | "legacyThreadMigration";
    readonly payload: unknown;
  },
): EnvironmentServerWelcomeState {
  return event.type === "welcome" && current.currentSession === session
    ? {
        ...current,
        welcomeSession: session,
        welcome: event.payload as ServerLifecycleWelcomePayload,
      }
    : current;
}

export interface EnvironmentServerWelcomeState {
  readonly currentSession: RpcSession | null;
  readonly welcomeSession: RpcSession | null;
  readonly welcome: ServerLifecycleWelcomePayload | null;
}

export function resolveServerWelcomeState(
  state: EnvironmentServerWelcomeState,
): ServerLifecycleWelcomePayload | null {
  return state.currentSession === state.welcomeSession ? state.welcome : null;
}

export const makeEnvironmentServerWelcomeState = Effect.fn("EnvironmentServerWelcomeState.make")(
  function* () {
    const supervisor = yield* EnvironmentSupervisor.EnvironmentSupervisor;
    const initialSession = Option.getOrNull(yield* SubscriptionRef.get(supervisor.session));
    const state = yield* SubscriptionRef.make<EnvironmentServerWelcomeState>({
      currentSession: initialSession,
      welcomeSession: null,
      welcome: null,
    });

    const updateWithCurrentSession = Effect.fn(
      "EnvironmentServerWelcomeState.updateWithCurrentSession",
    )(function* (
      update: (
        current: EnvironmentServerWelcomeState,
        currentSession: RpcSession | null,
      ) => EnvironmentServerWelcomeState,
    ) {
      return yield* SubscriptionRef.modifyEffect(state, (current) =>
        SubscriptionRef.get(supervisor.session).pipe(
          Effect.map(
            (latestSession) =>
              [undefined, update(current, Option.getOrNull(latestSession))] as const,
          ),
        ),
      );
    });

    yield* SubscriptionRef.changes(supervisor.session).pipe(
      Stream.runForEach(() =>
        updateWithCurrentSession((current, currentSession) => ({
          ...current,
          currentSession,
        })),
      ),
      Effect.forkScoped,
    );

    yield* subscribeDynamicWithSession(
      WS_METHODS.subscribeServerLifecycle,
      Effect.fn("EnvironmentServerWelcomeState.makeSubscribeInput")(function* (session) {
        yield* updateWithCurrentSession((current, currentSession) =>
          currentSession === session
            ? {
                ...current,
                currentSession,
                welcomeSession: session,
                welcome: null,
              }
            : { ...current, currentSession },
        );
        return {};
      }),
    ).pipe(
      Stream.runForEach(([session, event]) =>
        updateWithCurrentSession((current, currentSession) =>
          applyServerWelcomeEvent(
            {
              ...current,
              currentSession,
            },
            session,
            event,
          ),
        ),
      ),
      Effect.forkScoped,
    );

    return state;
  },
);

export function resolveServerConfigValue(
  projection: ServerConfigProjection | null,
  initialConfig: ServerConfig | null,
): ServerConfig | null {
  if (
    projection?.source === "live" &&
    (initialConfig === null ||
      projection.config.environment.serverVersion === initialConfig.environment.serverVersion)
  ) {
    return projection.config;
  }
  return initialConfig ?? projection?.config ?? null;
}
