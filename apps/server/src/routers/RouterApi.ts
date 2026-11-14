// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalTimersInEffect:off -- Socket callbacks own their cancellation timers.
import * as NodeNet from "node:net";
import * as NodeTls from "node:tls";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  VoucherFailureReason,
  type RouterProfile,
  type RouterProbeInput,
  type RouterProbeResult,
} from "@madar/contracts";
import { ApiDecoder, apiAttributes, encodeApiSentence } from "./apiProtocol.ts";

export class RouterApiError extends Schema.TaggedError<RouterApiError>()("RouterApiError", {
  reason: VoucherFailureReason,
}) {}

export function routerKey(profile: RouterProfile) {
  return JSON.stringify([
    profile.host.toLowerCase(),
    profile.port,
    profile.transport,
    profile.username,
  ]);
}

class ApiSocket {
  private socket: NodeNet.Socket;
  private decoder = new ApiDecoder();
  private next = 0;
  private pending = new Map<
    string,
    {
      rows: Record<string, string>[];
      bytes: number;
      failed: RouterApiError | undefined;
      done: (error: RouterApiError | undefined, rows: Record<string, string>[]) => void;
    }
  >();
  alive = true;
  constructor(profile: RouterProfile, ready: (error?: RouterApiError) => void) {
    this.socket =
      profile.transport === "tls"
        ? NodeTls.connect(
            {
              host: profile.host,
              port: profile.port,
              servername: NodeNet.isIP(profile.host) ? undefined : profile.host,
              rejectUnauthorized: true,
            },
            () => ready(),
          )
        : NodeNet.connect({ host: profile.host, port: profile.port }, () => ready());
    this.socket.setNoDelay(true);
    this.socket.setKeepAlive(true, 30000);
    this.socket.on("error", (error: NodeJS.ErrnoException) => {
      const reason = /CERT|TLS|SSL|SELF_SIGNED|VERIFY/.test(error.code ?? "") ? "tls" : "network";
      ready(new RouterApiError({ reason }));
      this.close(new RouterApiError({ reason }));
    });
    this.socket.on("close", () => this.close(new RouterApiError({ reason: "network" })));
    this.socket.on("data", (data: Buffer) => {
      try {
        this.decoder.push(data, (words) => {
          if (words[0] === "!fatal") return this.close(new RouterApiError({ reason: "network" }));
          const tag = words.find((word) => word.startsWith(".tag="))?.slice(5);
          const pending = tag
            ? this.pending.get(tag)
            : this.pending.size === 1
              ? this.pending.values().next().value
              : undefined;
          if (!pending) return;
          if (words[0] === "!trap") {
            const message = apiAttributes(words).message ?? "";
            pending.failed = new RouterApiError({
              reason: /permission|not enough/i.test(message)
                ? "permission"
                : /no such command|bad command/i.test(message)
                  ? "unsupported"
                  : "rejected",
            });
          }
          if (words[0] === "!re" || words[0] === "!done") {
            const attributes = apiAttributes(words);
            pending.bytes += words.reduce((n, word) => n + Buffer.byteLength(word), 0);
            if (pending.bytes > 64 * 1024 * 1024 || pending.rows.length >= 200000)
              return this.close(new RouterApiError({ reason: "protocol" }));
            if (Object.keys(attributes).length) pending.rows.push(attributes);
          }
          if (words[0] === "!done") pending.done(pending.failed, pending.rows);
        });
      } catch {
        this.close(new RouterApiError({ reason: "protocol" }));
      }
    });
  }
  request(words: readonly string[]) {
    return Effect.callback<readonly Record<string, string>[], RouterApiError>((resume) => {
      if (!this.alive) {
        resume(Effect.fail(new RouterApiError({ reason: "network" })));
        return;
      }
      const tag = String(++this.next);
      const timer = setTimeout(() => this.close(new RouterApiError({ reason: "timeout" })), 60000);
      this.pending.set(tag, {
        rows: [],
        bytes: 0,
        failed: undefined,
        done: (error, rows) => {
          clearTimeout(timer);
          this.pending.delete(tag);
          resume(error ? Effect.fail(error) : Effect.succeed(rows));
        },
      });
      try {
        this.socket.write(encodeApiSentence([...words, `.tag=${tag}`]));
      } catch {
        this.close(new RouterApiError({ reason: "protocol" }));
      }
      return Effect.sync(() => {
        if (this.pending.has(tag)) this.close(new RouterApiError({ reason: "network" }));
      });
    });
  }
  close(error = new RouterApiError({ reason: "disconnected" })) {
    this.alive = false;
    this.socket.destroy();
    for (const pending of this.pending.values()) pending.done(error, []);
  }
}

export class RouterApi extends Context.Service<
  RouterApi,
  {
    readonly connect: (input: RouterProbeInput, owner: string) => Effect.Effect<RouterProbeResult>;
    readonly status: (id: string, owner: string) => Effect.Effect<RouterProbeResult>;
    readonly disconnect: (id: string, owner: string) => Effect.Effect<boolean>;
    readonly execute: (
      profile: RouterProfile,
      owner: string,
      words: readonly string[],
    ) => Effect.Effect<readonly Record<string, string>[], RouterApiError>;
  }
>()("madar/routers/RouterApi") {}

const make = Effect.gen(function* () {
  const lock = yield* Semaphore.make(1);
  type Session = {
    input: RouterProbeInput;
    owner: string;
    socket: ApiSocket | null;
    identity: string;
    version: string;
  };
  const sessions = new Map<string, Session>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const session of sessions.values()) session.socket?.close();
      sessions.clear();
    }),
  );
  const open = Effect.fn("RouterApi.open")(function* (session: Session) {
    if (session.socket?.alive) return session.socket;
    if (session.input.profile.transport !== "tls" && session.input.profile.transport !== "tcp")
      return yield* new RouterApiError({ reason: "unsupported" });
    const socket = yield* Effect.callback<ApiSocket, RouterApiError>((resume) => {
      let accepted = false;
      const api = new ApiSocket(session.input.profile, (error) => {
        accepted = !error;
        resume(error ? Effect.fail(error) : Effect.succeed(api));
      });
      const timer = setTimeout(() => {
        api.close();
        resume(Effect.fail(new RouterApiError({ reason: "timeout" })));
      }, 10000);
      return Effect.sync(() => {
        clearTimeout(timer);
        if (!accepted) api.close();
      });
    });
    session.socket = socket;
    const login = yield* socket
      .request([
        "/login",
        `=name=${session.input.profile.username}`,
        `=password=${session.input.password}`,
      ])
      .pipe(
        Effect.mapError((error) =>
          error.reason === "rejected" ? new RouterApiError({ reason: "authentication" }) : error,
        ),
      );
    if (login[0]?.ret) {
      const challenge = login[0].ret;
      if (!/^[a-f0-9]{32}$/i.test(challenge))
        return yield* new RouterApiError({ reason: "protocol" });
      const response = NodeCrypto.createHash("md5")
        .update(Buffer.from([0]))
        .update(session.input.password)
        .update(Buffer.from(challenge, "hex"))
        .digest("hex");
      yield* socket
        .request(["/login", `=name=${session.input.profile.username}`, `=response=00${response}`])
        .pipe(
          Effect.mapError((error) =>
            error.reason === "rejected" ? new RouterApiError({ reason: "authentication" }) : error,
          ),
        );
    }
    const identity = yield* socket.request(["/system/identity/print", "=.proplist=name"]);
    const resource = yield* socket.request(["/system/resource/print", "=.proplist=version"]);
    session.identity = identity[0]?.name ?? "";
    session.version = resource[0]?.version ?? "";
    if (!/^6\.\d+(?:\.|\s|$)/.test(session.version))
      return yield* new RouterApiError({ reason: "unsupported" });
    return socket;
  });
  const connected = (session: Session): RouterProbeResult => ({
    kind: "connected",
    service: "router-api",
    identity: session.identity,
    version: session.version,
  });
  const failed = (error: RouterApiError): RouterProbeResult => ({
    kind: "failed",
    reason:
      error.reason === "rejected"
        ? "permission"
        : ["storage", "not-found", "conflict", "busy", "disconnected"].includes(error.reason)
          ? "network"
          : (error.reason as Extract<RouterProbeResult, { kind: "failed" }>["reason"]),
  });
  const connect = Effect.fn("RouterApi.connect")(function* (
    input: RouterProbeInput,
    owner: string,
  ) {
    for (const session of sessions.values()) session.socket?.close();
    sessions.clear();
    const session: Session = { input, owner, socket: null, identity: "", version: "" };
    sessions.set(input.profile.id, session);
    return yield* open(session).pipe(
      Effect.map(() => connected(session)),
      Effect.catch((error) => {
        session.socket?.close();
        return Effect.succeed(failed(error));
      }),
    );
  }, lock.withPermits(1));
  const status = Effect.fn("RouterApi.status")(function* (id: string, owner: string) {
    const session = sessions.get(id);
    if (!session || session.owner !== owner)
      return { kind: "failed", reason: "authentication" } as const;
    return yield* Effect.gen(function* () {
      const socket = yield* open(session);
      yield* socket.request(["/system/identity/print", "=.proplist=name"]);
      return connected(session);
    }).pipe(
      Effect.catch((error) => {
        session.socket?.close();
        return Effect.succeed(failed(error));
      }),
    );
  }, lock.withPermits(1));
  const execute = Effect.fn("RouterApi.execute")(function* (
    profile: RouterProfile,
    owner: string,
    words: readonly string[],
  ) {
    const session = sessions.get(profile.id);
    if (
      !session ||
      session.owner !== owner ||
      routerKey(session.input.profile) !== routerKey(profile)
    )
      return yield* new RouterApiError({ reason: "disconnected" });
    const socket = yield* open(session).pipe(
      Effect.tapError(() => Effect.sync(() => session.socket?.close())),
    );
    return yield* socket.request(words);
  }, lock.withPermits(1));
  return RouterApi.of({
    connect,
    status,
    execute,
    disconnect: Effect.fn("RouterApi.disconnect")(
      (id: string, owner: string) =>
        Effect.sync(() => {
          const session = sessions.get(id);
          if (session?.owner === owner) {
            session.socket?.close();
            sessions.delete(id);
          }
          return true;
        }),
      lock.withPermits(1),
    ),
  });
});
export const layer = Layer.effect(RouterApi, make);
