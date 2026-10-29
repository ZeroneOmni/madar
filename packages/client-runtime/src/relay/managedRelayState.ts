import type { EnvironmentId } from "@t3tools/contracts";
import { decodeRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Atom, AtomRegistry } from "effect/reactivity";
import * as ManagedRelay from "./managedRelay.ts";
const CLERK_TOKEN_EXPIRY_SKEW_MS = 5_000;

export interface ManagedRelaySession {
  readonly accountId: string;
  readonly readClerkToken: () => Effect.Effect<string | null, ManagedRelaySessionError>;
}

export interface ManagedRelaySessionInput {
  readonly accountId: string;
  readonly readClerkToken: () => Promise<string | null>;
}

interface ManagedRelaySessionControl {
  readonly updateReadClerkToken: (
    readClerkToken: ManagedRelaySessionInput["readClerkToken"],
  ) => void;
}

export interface ManagedRelaySnapshotState<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly errorTraceId: string | null;
  readonly isPending: boolean;
}

export interface ManagedRelayQueryEvent {
  readonly operation: "environments" | "devices" | "environment-status";
  readonly stage: "clerk-token" | "relay-request" | "validation";
  readonly phase: "start" | "success" | "failure";
  readonly accountId: string;
  readonly environmentId?: string;
  readonly message?: string;
  readonly traceId?: string | null;
}

export class ManagedRelaySessionError extends Data.TaggedError("ManagedRelaySessionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export const managedRelaySessionAtom = Atom.make<ManagedRelaySession | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("managed-relay:session"),
);

const managedRelaySessionControls = new WeakMap<ManagedRelaySession, ManagedRelaySessionControl>();

export function createManagedRelaySession(input: ManagedRelaySessionInput): ManagedRelaySession {
  let cachedToken: { readonly token: string; readonly expiresAtMillis: number } | null = null;
  let pendingToken: Promise<string | null> | null = null;
  let readClerkToken = input.readClerkToken;
  let tokenProviderGeneration = 0;

  const readCachedClerkToken = async (nowMillis: number): Promise<string | null> => {
    if (cachedToken && cachedToken.expiresAtMillis > nowMillis + CLERK_TOKEN_EXPIRY_SKEW_MS) {
      return cachedToken.token;
    }
    if (pendingToken) {
      return await pendingToken;
    }

    const operationGeneration = tokenProviderGeneration;
    const operation = readClerkToken().then((token) => {
      if (operationGeneration !== tokenProviderGeneration) {
        return token;
      }
      if (!token) {
        cachedToken = null;
        return null;
      }
      try {
        const expiresAtSeconds = decodeRelayJwt(token).exp;
        cachedToken =
          typeof expiresAtSeconds === "number"
            ? { token, expiresAtMillis: expiresAtSeconds * 1_000 }
            : null;
      } catch {
        cachedToken = null;
      }
      return token;
    });
    pendingToken = operation;
    try {
      return await operation;
    } finally {
      if (pendingToken === operation) {
        pendingToken = null;
      }
    }
  };

  const session: ManagedRelaySession = {
    accountId: input.accountId,
    readClerkToken: Effect.fn("clientRuntime.managedRelaySession.readClerkToken")(function* () {
      const nowMillis = yield* Clock.currentTimeMillis;
      return yield* Effect.tryPromise({
        try: () => readCachedClerkToken(nowMillis),
        catch: (cause) =>
          new ManagedRelaySessionError({
            message: "Could not obtain the T3 Connect session token.",
            cause,
          }),
      });
    }),
  };
  managedRelaySessionControls.set(session, {
    updateReadClerkToken: (nextReadClerkToken) => {
      readClerkToken = nextReadClerkToken;
      tokenProviderGeneration += 1;
      pendingToken = null;
    },
  });
  return session;
}

export function setManagedRelaySession(
  registry: AtomRegistry.AtomRegistry,
  input: ManagedRelaySessionInput | null,
): void {
  const current = registry.get(managedRelaySessionAtom);
  if (input === null) {
    if (current !== null) {
      registry.set(managedRelaySessionAtom, null);
    }
    return;
  }
  if (current?.accountId === input.accountId) {
    const control = managedRelaySessionControls.get(current);
    if (control) {
      // Clerk can replace its token reader during routine same-account refreshes.
      // Keep the session stable so those refreshes do not invalidate queries or reconnect leases.
      control.updateReadClerkToken(input.readClerkToken);
      return;
    }
  }
  registry.set(managedRelaySessionAtom, createManagedRelaySession(input));
}

function readSessionClerkToken(
  session: ManagedRelaySession,
): Effect.Effect<string, ManagedRelaySessionError> {
  return session.readClerkToken().pipe(
    Effect.filterOrFail(
      (token): token is string => Boolean(token),
      () =>
        new ManagedRelaySessionError({
          message: "The T3 Connect session token is unavailable.",
        }),
    ),
  );
}

export const deregisterManagedRelayEnvironment = Effect.fn(
  "clientRuntime.managedRelaySession.deregisterEnvironment",
)(function* (
  registry: AtomRegistry.AtomRegistry,
  input: { readonly accountId: string; readonly environmentId: EnvironmentId },
) {
  const session = registry.get(managedRelaySessionAtom);
  if (!session || session.accountId !== input.accountId) {
    return yield* new ManagedRelaySessionError({
      message: "Sign in to T3 Connect before deregistering an environment.",
    });
  }
  const clerkToken = yield* readSessionClerkToken(session);
  const relay = yield* ManagedRelay.ManagedRelayClient;
  yield* relay.unlinkEnvironment({ clerkToken, environmentId: input.environmentId });
});
