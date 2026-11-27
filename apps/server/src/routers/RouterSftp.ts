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
  /**
   * A busy RouterOS 6 router answered single reads after up to 12.5 s. This is the only limit on
   * a transfer: a slow copy runs as long as bytes keep arriving.
   */
  stallSeconds: 300,
  maxBytes: 256 * 1024 * 1024,
  automaticBytesPerSecond: 2 * 1024 * 1024,
} as const;
/** One SFTP request per read: ssh2 splits reads over 31,952 bytes for non-OpenSSH servers. */
const CHUNK = 31 * 1024;
/**
 * Reads in flight at once; 1 reads one request at a time. On a busy RouterOS 6.49 router over a
 * 360 ms link, 2 and 4 both copied about 1.5x faster than 1, and 8 stalled.
 */
export const READ_DEPTH = 2;

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
  /**
   * Streams one file to a local file, `READ_DEPTH` reads at a time. With `resumeFrom`, the
   * destination already holds that many bytes of the file and the copy continues after them.
   */
  readonly download: (
    path: string,
    destination: string,
    options: DownloadOptions,
  ) => Effect.Effect<number, RouterSftpError>;
}

export interface DownloadOptions {
  readonly bytesPerSecond: number | null;
  readonly resumeFrom?: number;
  readonly onProgress: (received: number, total: number) => Effect.Effect<void>;
}

export const hostKeyFingerprint = (key: Buffer) =>
  `SHA256:${NodeCrypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;

const failure = (reason: RouterSftpError["reason"]) => new RouterSftpError({ reason });
/** Every request to a router that stops answering fails after the stall limit. */
const withinStall = <A>(effect: Effect.Effect<A, RouterSftpError>) =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: `${SFTP_LIMITS.stallSeconds} seconds`,
      orElse: () => Effect.fail(failure("stalled")),
    }),
  );
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
      }).pipe(withinStall),
    );
    const open = (path: string) =>
      Effect.acquireRelease(
        Effect.callback<Buffer, RouterSftpError>((resume) => {
          sftp.open(path, "r", (error, handle) =>
            resume(error ? Effect.fail(statusFailure(error)) : Effect.succeed(handle)),
          );
        }).pipe(withinStall),
        // A quiet router may never answer the close; the socket closes after it either way.
        (handle) =>
          Effect.callback<void, RouterSftpError>((resume) => {
            sftp.close(handle, () => resume(Effect.void));
          }).pipe(withinStall, Effect.ignore),
      );
    // One read per chunk: tracing each would flood the trace; `download` owns the span.
    const read = (handle: Buffer, buffer: Buffer, position: number) =>
      Effect.callback<number, RouterSftpError>((resume) => {
        sftp.read(handle, buffer, 0, buffer.length, position, (error, bytesRead) => {
          // ssh2 reports end of file as an error with status code 1.
          if (error && (error as Error & { code?: unknown }).code === 1)
            return resume(Effect.succeed(0));
          resume(error ? Effect.fail(statusFailure(error)) : Effect.succeed(bytesRead));
        });
      }).pipe(withinStall);
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
      options: DownloadOptions,
    ) {
      const info = yield* stat(path);
      if (!info) return yield* failure("not-found");
      if (info.size > SFTP_LIMITS.maxBytes) return yield* failure("too-large");
      const handle = yield* open(path);
      const resumeFrom = options.resumeFrom ?? 0;
      const file = yield* fs
        .open(destination, { flag: resumeFrom > 0 ? "a" : "wx" })
        .pipe(Effect.mapError(() => failure("storage")));
      const started = yield* Clock.currentTimeMillis;
      const buffers = Array.from({ length: READ_DEPTH }, () => Buffer.alloc(CHUNK));
      let received = resumeFrom;
      while (true) {
        // Reads past the end of the file return 0, so the last batch may ask for more than remains.
        const counts = yield* Effect.forEach(
          buffers,
          (buffer, index) => read(handle, buffer, received + index * CHUNK),
          { concurrency: "unbounded" },
        );
        let written = 0;
        for (const [index, count] of counts.entries()) {
          if (count === 0) break;
          yield* file
            .writeAll(buffers[index]!.subarray(0, count))
            .pipe(Effect.mapError(() => failure("storage")));
          written += count;
          // A short read leaves a gap before the next chunk; the next batch starts after it.
          if (count < CHUNK) break;
        }
        if (written === 0) break;
        received += written;
        if (received > SFTP_LIMITS.maxBytes) return yield* failure("too-large");
        yield* options.onProgress(received, Math.max(info.size, received));
        if (options.bytesPerSecond !== null && received < info.size) {
          const due = started + ((received - resumeFrom) / options.bytesPerSecond) * 1000;
          const now = yield* Clock.currentTimeMillis;
          if (due > now) yield* Effect.sleep(`${Math.ceil(due - now)} millis`);
        }
      }
      return received;
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
