import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { RouterProfile } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";
import * as DesktopRouterCredentials from "./DesktopRouterCredentials.ts";

const profile: RouterProfile = {
  id: "office",
  name: "Office",
  host: "router.local",
  username: "admin",
  port: 8729,
  transport: "tls",
  color: "blue",
  icon: "router",
  label: "",
};
const password = "fixture-password";
const flip = (bytes: Uint8Array) => Uint8Array.from(bytes, (byte) => byte ^ 255);

function withStore<A, E, R>(
  run: (
    layer: Layer.Layer<
      DesktopRouterCredentials.DesktopRouterCredentials,
      never,
      FileSystem.FileSystem
    >,
    file: string,
  ) => Effect.Effect<A, E, R>,
  available = true,
  backend = Option.none<string>(),
) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "madar-router-credentials-" });
    const layer = DesktopRouterCredentials.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          DesktopEnvironment.layer({
            dirname: stateDir,
            homeDirectory: stateDir,
            platform: "win32",
            processArch: "x64",
            appVersion: "0.1.2",
            appPath: stateDir,
            isPackaged: false,
            resourcesPath: stateDir,
            runningUnderArm64Translation: false,
          }).pipe(
            Layer.provide(
              Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ MADAR_HOME: stateDir })),
            ),
            Layer.orDie,
          ),
          Layer.mock(ElectronSafeStorage.ElectronSafeStorage, {
            isEncryptionAvailable: Effect.succeed(available),
            selectedStorageBackend: Effect.succeed(backend),
            encryptString: (value) => Effect.succeed(flip(new TextEncoder().encode(value))),
            decryptString: (bytes) => Effect.succeed(new TextDecoder().decode(flip(bytes))),
          }),
        ),
      ),
    );
    return yield* run(layer, path.join(stateDir, "userdata", "router-credentials.bin"));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);
}

it.effect("stores only encrypted bytes and preserves credentials during concurrent saves", () =>
  withStore((layer, file) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const store = yield* DesktopRouterCredentials.DesktopRouterCredentials;
      const second = { ...profile, id: "second" };
      yield* Effect.all(
        [
          store.access({ kind: "set", profile, password }),
          store.access({ kind: "set", profile: second, password: "second-password" }),
        ],
        { concurrency: "unbounded" },
      );
      const bytes = yield* fs.readFile(file);
      assert.notInclude(new TextDecoder().decode(bytes), password);
      assert.notInclude(new TextDecoder().decode(bytes), "second-password");
      assert.equal(yield* store.access({ kind: "get", profile }), password);
      assert.equal(yield* store.access({ kind: "get", profile: second }), "second-password");
    }).pipe(Effect.provide(layer)),
  ),
);

it.effect("does not overwrite a damaged credential file", () =>
  withStore((layer, file) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const store = yield* DesktopRouterCredentials.DesktopRouterCredentials;
      yield* store.access({ kind: "set", profile, password });
      const damaged = new TextEncoder().encode("damaged fixture");
      yield* fs.writeFile(file, damaged);
      const result = yield* Effect.flip(
        store.access({ kind: "set", profile, password: "replacement" }),
      );
      assert.equal(result.operation, "read");
      assert.deepEqual(yield* fs.readFile(file), damaged);
    }).pipe(Effect.provide(layer)),
  ),
);

it.effect(
  "restores encrypted passwords after reconstructing the service, including blank passwords",
  () =>
    withStore((layer) =>
      Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const store = yield* DesktopRouterCredentials.DesktopRouterCredentials;
          assert.isNull(yield* store.access({ kind: "get", profile }));
          yield* store.access({ kind: "set", profile, password });
          yield* store.access({ kind: "set", profile: { ...profile, id: "blank" }, password: "" });
        }).pipe(Effect.provide(layer));
        yield* Effect.gen(function* () {
          const store = yield* DesktopRouterCredentials.DesktopRouterCredentials;
          assert.equal(yield* store.access({ kind: "get", profile }), password);
          assert.equal(
            yield* store.access({ kind: "get", profile: { ...profile, id: "blank" } }),
            "",
          );
          assert.isNull(
            yield* store.access({ kind: "get", profile: { ...profile, host: "other.local" } }),
          );
          assert.isNull(
            yield* store.access({ kind: "get", profile: { ...profile, username: "other" } }),
          );
          yield* store.access({ kind: "remove", profileId: profile.id });
          assert.isNull(yield* store.access({ kind: "get", profile }));
          assert.equal(
            yield* store.access({ kind: "get", profile: { ...profile, id: "blank" } }),
            "",
          );
        }).pipe(Effect.provide(layer));
      }),
    ),
);

it.effect.each([
  { available: false, backend: Option.none<string>() },
  { available: true, backend: Option.some("basic_text") },
])("refuses an unprotected credential store: $available / $backend", ({ available, backend }) =>
  withStore(
    (layer) =>
      Effect.gen(function* () {
        const store = yield* DesktopRouterCredentials.DesktopRouterCredentials;
        const result = yield* Effect.flip(store.access({ kind: "set", profile, password }));
        assert.equal(result.operation, "unavailable");
      }).pipe(Effect.provide(layer)),
    available,
    backend,
  ),
);
