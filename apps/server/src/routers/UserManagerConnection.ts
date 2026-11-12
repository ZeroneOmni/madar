// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Stream from "effect/Stream";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as KeyedLock from "@madar/shared/KeyedLock";
import { Cookies, HttpClient, HttpClientRequest, FetchHttpClient } from "effect/http";
import type { RouterProbeInput, RouterProbeResult } from "@madar/contracts";
import {
  initializeMessage,
  isLoginMessage,
  isLogoutMessage,
  keepAliveMessage,
  loginMessage,
  logoutControl,
  logoutMessage,
  parseUserManagerMessage,
  synchronizeUrl,
  transactionId,
} from "./userManagerProtocol.ts";

const FailureReason = Schema.Literals([
  "network",
  "timeout",
  "authentication",
  "permission",
  "protocol",
  "unsupported",
  "tls",
]);
class UserManagerRequestError extends Schema.TaggedError<UserManagerRequestError>()(
  "UserManagerRequestError",
  {
    reason: FailureReason,
    cause: Schema.Defect(),
  },
) {}

type Session = {
  url: string;
  cookies: Cookies.Cookies;
  transaction: string;
  logout: string;
  fingerprint: string;
  touched: number;
};

function isTlsFailure(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  if (
    "code" in cause &&
    typeof cause.code === "string" &&
    /CERT|TLS|SSL|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(cause.code)
  )
    return true;
  return isTlsFailure(cause.cause);
}

export class UserManagerConnection extends Context.Service<
  UserManagerConnection,
  {
    readonly check: (input: RouterProbeInput, owner: string) => Effect.Effect<RouterProbeResult>;
    readonly disconnect: (profileId: string, owner: string) => Effect.Effect<boolean>;
  }
>()("madar/routers/UserManagerConnection") {}

const make = Effect.gen(function* () {
  const http = yield* HttpClient.HttpClient;
  const locks = yield* KeyedLock.make<string>();
  const sessions = new Map<string, Session>();
  yield* Effect.addFinalizer(() => Effect.sync(() => sessions.clear()));
  const request = Effect.fn("UserManagerConnection.request")(function* (
    url: string,
    cookies: Cookies.Cookies,
    body?: string,
  ) {
    let req =
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyText(body, "text/xml"));
    req = req.pipe(
      HttpClientRequest.setHeaders({
        cookie: Cookies.toCookieHeader(cookies),
        "cache-control": "no-store",
      }),
    );
    const response = yield* http.execute(req).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.mapError(
        (cause) =>
          new UserManagerRequestError({
            reason: isTlsFailure(cause) ? "tls" : "network",
            cause,
          }),
      ),
    );
    const responseBody = yield* Stream.runFoldEffect(
      response.stream.pipe(
        Stream.mapError((cause) => new UserManagerRequestError({ reason: "protocol", cause })),
      ),
      () => ({ size: 0, chunks: Array<Uint8Array>() }),
      (state, chunk) => {
        if (state.size + chunk.byteLength > 2_000_000)
          return Effect.fail(
            new UserManagerRequestError({ reason: "protocol", cause: "response too large" }),
          );
        state.size += chunk.byteLength;
        state.chunks.push(chunk);
        return Effect.succeed(state);
      },
    );
    const text = new TextDecoder().decode(Buffer.concat(responseBody.chunks));
    if (response.status < 200 || response.status >= 300)
      return yield* new UserManagerRequestError({
        reason:
          response.status === 401 || response.status === 400
            ? "authentication"
            : response.status === 403
              ? "permission"
              : "unsupported",
        cause: response.status,
      });
    return { text, cookies: Cookies.merge(cookies, response.cookies) };
  }, Effect.withTracerEnabled(false));
  const parse = (text: string) =>
    Effect.try({
      try: () => parseUserManagerMessage(text),
      catch: (cause) => new UserManagerRequestError({ reason: "protocol", cause }),
    });
  const check = Effect.fn("UserManagerConnection.check")((
    input: RouterProbeInput,
    owner: string,
  ) => {
    const key = `${owner}:${input.profile.id}`;
    const operation = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      for (const [key, session] of sessions)
        if (now - session.touched > 120_000) sessions.delete(key);
      const { profile } = input;
      const scheme = profile.transport === "user-manager-https" ? "https" : "http";
      const host = profile.host.includes(":") ? `[${profile.host}]` : profile.host;
      const entry = yield* Effect.try({
        try: () => new URL(`${scheme}://${host}:${profile.port}/userman`),
        catch: (cause) => new UserManagerRequestError({ reason: "unsupported", cause }),
      });
      const fingerprint = NodeCrypto.createHash("sha256")
        .update(entry.href)
        .update("\0")
        .update(profile.username)
        .update("\0")
        .update(input.password)
        .digest("hex");
      const session = sessions.get(key);
      if (session?.fingerprint === fingerprint) {
        const response = yield* request(
          session.url,
          session.cookies,
          keepAliveMessage(session.transaction),
        );
        const message = yield* parse(response.text);
        const loginShown = isLoginMessage(message);
        if (loginShown || message.getElementsByTagName("redirect").length > 0)
          return yield* new UserManagerRequestError({
            reason: "authentication",
            cause: "session expired",
          });
        session.cookies = response.cookies;
        session.transaction = transactionId(message);
        session.touched = now;
        return {
          kind: "connected",
          service: "user-manager",
          customer: profile.username,
        } satisfies RouterProbeResult;
      }
      sessions.delete(key);
      const page = yield* request(entry.href, Cookies.empty);
      const url = yield* Effect.try({
        try: () => synchronizeUrl(page.text, entry),
        catch: (cause) => new UserManagerRequestError({ reason: "unsupported", cause }),
      });
      const initial = yield* request(url, page.cookies, initializeMessage);
      const login = yield* parse(initial.text);
      const body = yield* Effect.try({
        try: () => loginMessage(login, profile.username, input.password),
        catch: (cause) => new UserManagerRequestError({ reason: "unsupported", cause }),
      });
      const response = yield* request(url, initial.cookies, body);
      const message = yield* parse(response.text);
      const logout = logoutControl(message);
      if (!logout) {
        const rejected = /invalid|incorrect|failed|unknown|not found/i.test(
          message.documentElement?.textContent ?? "",
        );
        return yield* new UserManagerRequestError({
          reason: rejected ? "authentication" : "protocol",
          cause: "customer login not confirmed",
        });
      }
      if (sessions.size >= 128)
        return yield* new UserManagerRequestError({
          reason: "protocol",
          cause: "session capacity",
        });
      sessions.set(key, {
        url,
        cookies: response.cookies,
        transaction: transactionId(message),
        logout,
        fingerprint,
        touched: now,
      });
      return {
        kind: "connected",
        service: "user-manager",
        customer: profile.username,
      } satisfies RouterProbeResult;
    });
    return locks.withLock(key, operation).pipe(
      Effect.timeoutOption("15 seconds"),
      Effect.map(
        Option.getOrElse(() => ({ kind: "failed", reason: "timeout" }) satisfies RouterProbeResult),
      ),
      Effect.catchTags({
        UserManagerRequestError: ({ reason }) =>
          Effect.succeed({ kind: "failed", reason } satisfies RouterProbeResult),
      }),
      Effect.tap((result) =>
        result.kind === "failed" ? Effect.sync(() => sessions.delete(key)) : Effect.void,
      ),
      Effect.onInterrupt(() => Effect.sync(() => sessions.delete(key))),
    );
  });
  const disconnect = Effect.fn("UserManagerConnection.disconnect")((
    profileId: string,
    owner: string,
  ) => {
    const key = `${owner}:${profileId}`;
    return locks
      .withLock(
        key,
        Effect.gen(function* () {
          const session = sessions.get(key);
          sessions.delete(key);
          if (session) {
            const response = yield* request(
              session.url,
              session.cookies,
              logoutMessage(session.transaction, session.logout),
            );
            const message = yield* parse(response.text);
            return isLogoutMessage(message, session.url);
          }
          return true;
        }),
      )
      .pipe(
        Effect.timeoutOption("5 seconds"),
        Effect.map(Option.getOrElse(() => false)),
        Effect.catchTags({ UserManagerRequestError: () => Effect.succeed(false) }),
      );
  });
  return UserManagerConnection.of({ check, disconnect });
});

export const layer = Layer.effect(UserManagerConnection, make);
