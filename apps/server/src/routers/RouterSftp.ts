// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";
import type * as Ssh2 from "ssh2";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";

const requireSsh = NodeModule.createRequire(import.meta.url);

export class RouterSftpError extends Schema.TaggedError<RouterSftpError>()("RouterSftpError", {
  reason: Schema.Literals([
    "ssh-off",
    "network",
    "timeout",
    "authentication",
    "permission",
    "host-key",
    "not-found",
    "too-large",
    "stalled",
    "storage",
  ]),
  /** The SHA-256 key the router presented, for host-key failures. */
  offeredHostKey: Schema.optional(Schema.String),
}) {}

export const SFTP_LIMITS = {
  connectSeconds: 10,
  /** A busy RouterOS 6 router answered single reads after up to 12.5 s. */
  stallSeconds: 30,
  /** The whole transfer may run as long as at this rate; RouterOS 6 measured 50–115 KiB/s. */
  slowBytesPerSecond: 30 * 1024,
  minTransferSeconds: 180,
  maxTransferSeconds: 3600,
  maxBytes: 256 * 1024 * 1024,
  automaticBytesPerSecond: 2 * 1024 * 1024,
} as const;
const CHUNK = 64 * 1024;
const transferSeconds = (size: number) =>
  Math.min(
    SFTP_LIMITS.maxTransferSeconds,
    Math.max(SFTP_LIMITS.minTransferSeconds, Math.ceil(size / SFTP_LIMITS.slowBytesPerSecond)),
  );

export interface RemoteFile {
  readonly size: number;
  /** Seconds since the epoch, as the router reports it. */
  readonly mtime: number;
}
export interface SftpSession {
  /** The router's SSH host key, "SHA256:<base64>". */
  readonly hostKey: string;
  readonly stat: (path: string) => Effect.Effect<RemoteFile | null, RouterSftpError>;
  readonly head: (path: string, length: number) => Effect.Effect<Uint8Array, RouterSftpError>;
  /** Streams one file to a new local file; at most one read is outstanding. */
  readonly download: (
    path: string,
    destination: string,
    options: {
      readonly bytesPerSecond: number | null;
      readonly onProgress: (received: number, total: number) => Effect.Effect<void>;
    },
  ) => Effect.Effect<number, RouterSftpError>;
}

export const hostKeyFingerprint = (key: Buffer) =>
  `SHA256:${NodeCrypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;

const failure = (reason: RouterSftpError["reason"]) => new RouterSftpError({ reason });
/** SFTP status codes: 2 is "no such file", 3 is "permission denied". */
const statusFailure = (error: Error & { code?: unknown }) =>
  failure(error.code === 2 ? "not-found" : error.code === 3 ? "permission" : "network");

export class RouterSftp extends Context.Service<
  RouterSftp,
  {
    /** Opens an SFTP session; closing the scope closes the socket. Fails on a changed host key. */
    readonly connect: (input: {
      readonly host: string;
      readonly port: number;
      readonly username: string;
      readonly password: string;
      /** The pinned key, or null to accept and report the router's key on first use. */
      readonly hostKey: string | null;
    }) => Effect.Effect<SftpSession, RouterSftpError, Scope.Scope>;
  }
>()("madar/routers/RouterSftp") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const session = (sftp: Ssh2.SFTPWrapper, hostKey: string): SftpSession => {
    const stat = Effect.fn("RouterSftp.stat")((path: string) =>
      Effect.callback<RemoteFile | null, RouterSftpError>((resume) => {
        sftp.stat(path, (error, stats) => {
          if (!error) resume(Effect.succeed({ size: stats.size, mtime: stats.mtime }));
          else if ((error as Error & { code?: unknown }).code === 2) resume(Effect.succeed(null));
          else resume(Effect.fail(statusFailure(error)));
        });
      }),
    );
    const open = (path: string) =>
      Effect.acquireRelease(
        Effect.callback<Buffer, RouterSftpError>((resume) => {
          sftp.open(path, "r", (error, handle) =>
            resume(error ? Effect.fail(statusFailure(error)) : Effect.succeed(handle)),
          );
        }),
        (handle) =>
          Effect.callback<void>((resume) => {
            sftp.close(handle, () => resume(Effect.void));
          }),
      );
    // One read per chunk: tracing each would flood the trace; `download` owns the span.
    const read = Effect.fnUntraced(function* (handle: Buffer, buffer: Buffer, position: number) {
      return yield* Effect.callback<number, RouterSftpError>((resume) => {
        sftp.read(handle, buffer, 0, buffer.length, position, (error, bytesRead) => {
          // ssh2 reports end of file as an error with status code 1.
          if (error && (error as Error & { code?: unknown }).code === 1)
            return resume(Effect.succeed(0));
          resume(error ? Effect.fail(statusFailure(error)) : Effect.succeed(bytesRead));
        });
      }).pipe(
        Effect.timeoutOrElse({
          duration: `${SFTP_LIMITS.stallSeconds} seconds`,
          orElse: () => Effect.fail(failure("stalled")),
        }),
      );
    });
    const head = Effect.fn("RouterSftp.head")(function* (path: string, length: number) {
      const handle = yield* open(path);
      const buffer = Buffer.alloc(length);
      let filled = 0;
      while (filled < length) {
        const count = yield* read(handle, buffer.subarray(filled), filled);
        if (count === 0) break;
        filled += count;
      }
      return new Uint8Array(buffer.subarray(0, filled));
    }, Effect.scoped);
    const download = Effect.fn("RouterSftp.download")(function* (
      path: string,
      destination: string,
      options: {
        readonly bytesPerSecond: number | null;
        readonly onProgress: (received: number, total: number) => Effect.Effect<void>;
      },
    ) {
      const info = yield* stat(path).pipe(
        Effect.timeoutOrElse({
          duration: `${SFTP_LIMITS.stallSeconds} seconds`,
          orElse: () => Effect.fail(failure("stalled")),
        }),
      );
      if (!info) return yield* failure("not-found");
      if (info.size > SFTP_LIMITS.maxBytes) return yield* failure("too-large");
      return yield* Effect.gen(function* () {
        const handle = yield* open(path);
        const file = yield* fs
          .open(destination, { flag: "wx" })
          .pipe(Effect.mapError(() => failure("storage")));
        const started = yield* Clock.currentTimeMillis;
        const buffer = Buffer.alloc(CHUNK);
        let received = 0;
        while (true) {
          const count = yield* read(handle, buffer, received);
          if (count === 0) break;
          received += count;
          if (received > SFTP_LIMITS.maxBytes) return yield* failure("too-large");
          yield* file
            .writeAll(buffer.subarray(0, count))
            .pipe(Effect.mapError(() => failure("storage")));
          yield* options.onProgress(received, Math.max(info.size, received));
          if (options.bytesPerSecond !== null && received < info.size) {
            const due = started + (received / options.bytesPerSecond) * 1000;
            const now = yield* Clock.currentTimeMillis;
            if (due > now) yield* Effect.sleep(`${Math.ceil(due - now)} millis`);
          }
        }
        return received;
      }).pipe(
        Effect.timeoutOrElse({
          duration: `${transferSeconds(info.size)} seconds`,
          orElse: () => Effect.fail(failure("timeout")),
        }),
      );
    }, Effect.scoped);
    return { hostKey, stat, head, download };
  };

  const connect = Effect.fn("RouterSftp.connect")(function* (input: {
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly password: string;
    readonly hostKey: string | null;
  }) {
    const opened = yield* Effect.acquireRelease(
      Effect.callback<
        { client: Ssh2.Client; sftp: Ssh2.SFTPWrapper; hostKey: string },
        RouterSftpError
      >((resume) => {
        const { Client } = requireSsh("ssh2") as typeof Ssh2;
        const client = new Client();
        let done = false;
        let presented = "";
        const finish = (result: Effect.Effect<never, RouterSftpError>) => {
          if (done) return;
          done = true;
          client.destroy();
          resume(result);
        };
        client.on("error", (error: Error & { level?: string; code?: string }) => {
          finish(
            Effect.fail(
              failure(
                error.code === "ECONNREFUSED"
                  ? "ssh-off"
                  : error.level === "client-authentication"
                    ? "authentication"
                    : error.level === "client-timeout"
                      ? "timeout"
                      : "network",
              ),
            ),
          );
        });
        client.on("close", () => finish(Effect.fail(failure("network"))));
        client.on("ready", () => {
          client.sftp((error, sftp) => {
            if (done) return;
            if (error) return finish(Effect.fail(failure("permission")));
            done = true;
            resume(Effect.succeed({ client, sftp, hostKey: presented }));
          });
        });
        client.connect({
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.password,
          readyTimeout: SFTP_LIMITS.connectSeconds * 1000,
          // Password only: never offer local agent keys to a router.
          tryKeyboard: false,
          hostVerifier: (key: Buffer) => {
            presented = hostKeyFingerprint(key);
            if (input.hostKey !== null && presented !== input.hostKey) {
              finish(
                Effect.fail(new RouterSftpError({ reason: "host-key", offeredHostKey: presented })),
              );
              return false;
            }
            return true;
          },
        });
        return Effect.sync(() => {
          done = true;
          client.destroy();
        });
      }).pipe(
        Effect.timeoutOrElse({
          duration: `${SFTP_LIMITS.connectSeconds} seconds`,
          orElse: () => Effect.fail(failure("timeout")),
        }),
      ),
      ({ client }) => Effect.sync(() => client.destroy()),
    );
    return session(opened.sftp, opened.hostKey);
  });

  return RouterSftp.of({ connect });
});

export const layer = Layer.effect(RouterSftp, make);
