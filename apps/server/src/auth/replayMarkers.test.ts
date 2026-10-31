import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as ReplayMarkers from "./replayMarkers.ts";
import * as ServerConfig from "../config.ts";
import { pruneExpiredReplayMarkers, REPLAY_MARKER_MAX_AGE } from "./replayMarkers.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";

const REAL_SECRET_NAMES = [
  "server-signing-key",
  "asset-access-signing-key",
  "cloud-cli-oauth-token",
  "cloud-cli-desired-link",
  "cloud-link-ed25519-key-pair",
  "cloud-link-ed25519-private-key",
  "cloud-link-ed25519-public-key",
  "cloud-mint-ed25519-public-key",
  "cloud-endpoint-runtime-config",
  "cloud-endpoint-confirmed-origin",
  "cloud-linked-user-id",
  "cloud-relay-url",
  "cloud-relay-issuer",
  "cloud-relay-environment-credential",
  "cloud-publish-agent-activity",
  "provider-env-Y29kZXg-T1BFTkFJX0FQSV9LRVk",
  "provider-auth-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0",
  "usage-limit-source-aHVi",
];

it.layer(NodeServices.layer)("replayMarkers", (it) => {
  it.effect("prunes expired authentication markers when the cleanup layer starts", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { secretsDir } = yield* ServerConfig.ServerConfig;
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      yield* secretStore.create("dpop-proof-expired", Uint8Array.from([1]));
      const markerPath = path.join(secretsDir, "dpop-proof-expired.bin");
      const mtime = DateTime.toDateUtc(DateTime.makeUnsafe(0));
      yield* fileSystem.utimes(markerPath, mtime, mtime);
      yield* TestClock.setTime(Duration.toMillis(Duration.days(2)));
      const removed = yield* Deferred.make<void>();
      yield* Layer.build(ReplayMarkers.layer).pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fileSystem,
          remove: (target, options) =>
            fileSystem
              .remove(target, options)
              .pipe(Effect.tap(() => Deferred.succeed(removed, undefined))),
        }),
      );
      yield* Deferred.await(removed);
      assert.isFalse(yield* fileSystem.exists(markerPath));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerSecretStore.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "madar-replay-cleanup-test-" }),
          ),
        ),
      ),
    ),
  );
  it.effect("prunes only replay markers older than the max age", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;
      const { secretsDir } = yield* ServerConfig.ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
      const setAge = (fileName: string, age: Duration.Duration) => {
        const mtime = DateTime.toDateUtc(DateTime.subtractDuration(now, age));
        return fileSystem.utimes(path.join(secretsDir, fileName), mtime, mtime);
      };
      const writeAged = (name: string, age: Duration.Duration) =>
        secretStore
          .create(name, Uint8Array.from([1]))
          .pipe(Effect.andThen(setAge(`${name}.bin`, age)));

      const justExpired = Duration.sum(REPLAY_MARKER_MAX_AGE, Duration.seconds(1));
      const expiredMarkers = ["dpop-proof-old"];
      for (const name of expiredMarkers) yield* writeAged(name, justExpired);
      yield* writeAged("dpop-proof-at-max-age", REPLAY_MARKER_MAX_AGE);
      for (const name of REAL_SECRET_NAMES) yield* writeAged(name, Duration.days(30));
      const pendingSetFile = "dpop-proof-pending.bin.0000.tmp";
      yield* fileSystem.writeFile(path.join(secretsDir, pendingSetFile), Uint8Array.from([1]));
      yield* setAge(pendingSetFile, Duration.days(30));
      yield* TestClock.setTime(DateTime.toEpochMillis(now));

      yield* pruneExpiredReplayMarkers();

      const remaining = yield* fileSystem.readDirectory(secretsDir);
      assert.deepStrictEqual(
        remaining.toSorted(),
        [
          ...REAL_SECRET_NAMES.map((name) => `${name}.bin`),
          "dpop-proof-at-max-age.bin",
          pendingSetFile,
        ].toSorted(),
      );
    }).pipe(
      Effect.provide(
        ServerSecretStore.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "madar-replay-markers-test-" }),
          ),
        ),
      ),
    ),
  );
});
