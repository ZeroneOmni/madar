import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import * as RouterSftp from "./RouterSftp.ts";
import { closedPort, sftpFixture } from "./sftpFixture.ts";

const services = RouterSftp.layer.pipe(Layer.provideMerge(NodeServices.layer));
const input = (port: number, hostKey: string | null, password = "fixture") => ({
  host: "127.0.0.1",
  port,
  username: "admin",
  password,
  hostKey,
});

it.live("pins the router's key on first use and refuses a changed key", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireDisposable(Effect.promise(() => sftpFixture(new Map())));
    const sftp = yield* RouterSftp.RouterSftp;
    const first = yield* Effect.scoped(sftp.connect(input(server.port, null)));
    expect(first.hostKey).toBe(server.hostKey);
    yield* Effect.scoped(sftp.connect(input(server.port, server.hostKey)));
    const changed = yield* Effect.scoped(
      sftp.connect(input(server.port, `SHA256:${"A".repeat(43)}`)),
    ).pipe(Effect.flip);
    expect(changed).toMatchObject({ reason: "host-key", offeredHostKey: server.hostKey });
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.live("reports refused SSH and a rejected login as distinct reasons", () =>
  Effect.gen(function* () {
    const server = yield* Effect.acquireDisposable(Effect.promise(() => sftpFixture(new Map())));
    const sftp = yield* RouterSftp.RouterSftp;
    const refused = yield* Effect.scoped(
      sftp.connect(input(yield* Effect.promise(closedPort), null)),
    ).pipe(Effect.flip);
    expect(refused.reason).toBe("ssh-off");
    const rejected = yield* Effect.scoped(
      sftp.connect(input(server.port, server.hostKey, "wrong")),
    ).pipe(Effect.flip);
    expect(rejected.reason).toBe("authentication");
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.live("streams a file to a new local file with progress, and reports missing files", () =>
  Effect.gen(function* () {
    const data = Buffer.alloc(300_000, 3);
    const server = yield* Effect.acquireDisposable(
      Effect.promise(() =>
        sftpFixture(new Map([["user-manager/sqldb", { data, mtime: 1_700_000_000 }]])),
      ),
    );
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "madar-sftp-" });
    const sftp = yield* RouterSftp.RouterSftp;
    yield* Effect.gen(function* () {
      const session = yield* sftp.connect(input(server.port, server.hostKey));
      expect(yield* session.stat("user-manager/sqldb")).toEqual({
        size: data.length,
        mtime: 1_700_000_000,
      });
      expect(yield* session.stat("user-manager/sqldb-journal")).toBeNull();
      expect(Buffer.from(yield* session.head("user-manager/sqldb", 100))).toEqual(
        data.subarray(0, 100),
      );
      const progress: number[] = [];
      const destination = path.join(directory, "copy");
      const received = yield* session.download("user-manager/sqldb", destination, {
        bytesPerSecond: null,
        onProgress: (count) => Effect.sync(() => progress.push(count)),
      });
      expect(received).toBe(data.length);
      expect(progress.at(-1)).toBe(data.length);
      expect(Buffer.from(yield* fs.readFile(destination))).toEqual(data);
      const missing = yield* session
        .download("user-manager/missing", path.join(directory, "missing"), {
          bytesPerSecond: null,
          onProgress: () => Effect.void,
        })
        .pipe(Effect.flip);
      expect(missing.reason).toBe("not-found");
    }).pipe(Effect.scoped);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.live("closes the local file and the socket when a download is cancelled", () =>
  Effect.gen(function* () {
    const reading = yield* Deferred.make<void>();
    const server = yield* Effect.acquireDisposable(
      Effect.promise(() =>
        sftpFixture(new Map([["user-manager/sqldb", { data: Buffer.alloc(1024), mtime: 1 }]]), {
          stallAfter: 0,
          onRead: () => Deferred.doneUnsafe(reading, Effect.void),
        }),
      ),
    );
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "madar-sftp-" });
    const destination = path.join(directory, "copy");
    const sftp = yield* RouterSftp.RouterSftp;
    const fiber = yield* Effect.gen(function* () {
      const session = yield* sftp.connect(input(server.port, server.hostKey));
      return yield* session.download("user-manager/sqldb", destination, {
        bytesPerSecond: null,
        onProgress: () => Effect.void,
      });
    }).pipe(Effect.scoped, Effect.forkChild);
    yield* Deferred.await(reading);
    yield* Fiber.interrupt(fiber);
    yield* Effect.promise(() => server.closedConnections(1));
    // Windows refuses to delete a file that still has an open handle.
    yield* fs.remove(destination);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("gives a large file on a slow router more time than a small one", () =>
  Effect.gen(function* () {
    const answers = yield* Queue.unbounded<() => void>();
    // 8 MiB at the 30 KiB/s floor may take 274 s, past the 180 s every transfer gets.
    const server = yield* Effect.acquireDisposable(
      Effect.promise(() =>
        sftpFixture(
          new Map([["user-manager/sqldb", { data: Buffer.alloc(8 * 1024 * 1024), mtime: 1 }]]),
          { hold: (answer) => Queue.offerUnsafe(answers, answer) },
        ),
      ),
    );
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "madar-sftp-" });
    const sftp = yield* RouterSftp.RouterSftp;
    const session = yield* sftp.connect(input(server.port, server.hostKey));
    const download = yield* session
      .download("user-manager/sqldb", path.join(directory, "copy"), {
        bytesPerSecond: null,
        onProgress: () => Effect.void,
      })
      .pipe(Effect.flip, Effect.forkChild);
    // ssh2 asks for a 64 KiB chunk in three requests; 5 s each is slow but never a 30 s stall.
    let next = yield* Queue.takeAll(answers);
    for (let seconds = 5; seconds <= 270; seconds += 5) {
      yield* TestClock.adjust("5 seconds");
      for (const answer of next) answer();
      // A new request means the transfer is still running, well past 180 s.
      next = yield* Queue.takeAll(answers).pipe(
        Effect.raceFirst(
          Fiber.join(download).pipe(
            Effect.flatMap((error) => Effect.die(`ended at ${seconds} s: ${error.reason}`)),
          ),
        ),
      );
    }
    // The router goes quiet at 270 s: the size limit ends the transfer before the 30 s stall.
    yield* TestClock.adjust("5 seconds");
    expect((yield* Fiber.join(download)).reason).toBe("timeout");
  }).pipe(Effect.scoped, Effect.provide(services)),
);
