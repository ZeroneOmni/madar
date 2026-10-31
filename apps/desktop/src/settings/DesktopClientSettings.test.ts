import { symlinksSupported } from "@madar/shared/testing/symlinks";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
} from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopClientSettings from "./DesktopClientSettings.ts";

const clientSettings: ClientSettings = { ...DEFAULT_CLIENT_SETTINGS, confirmQuit: "double-click" };

const decodeClientSettingsJson = Schema.decodeEffect(Schema.fromJsonString(ClientSettingsSchema));
function layer(baseDir: string) {
  const layerEnvironment = DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion: "1.2.3",
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ MADAR_HOME: baseDir })),
    ),
  );

  return DesktopClientSettings.layer.pipe(
    Layer.provideMerge(layerEnvironment),
    Layer.provideMerge(NodeServices.layer),
  );
}

const withClientSettings = <A, E, R>(
  effect: Effect.Effect<A, E, R | DesktopClientSettings.DesktopClientSettings>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "madar-desktop-client-settings-test-",
    });
    return yield* effect.pipe(Effect.provide(layer(baseDir)));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

describe("DesktopClientSettings", () => {
  it.effect.skipIf(!symlinksSupported)(
    "saves through a symlinked client settings file without replacing the link",
    () =>
      withClientSettings(
        Effect.gen(function* () {
          const environment = yield* DesktopEnvironment.DesktopEnvironment;
          const fileSystem = yield* FileSystem.FileSystem;
          const settings = yield* DesktopClientSettings.DesktopClientSettings;
          const dotfiles = yield* fileSystem.makeTempDirectoryScoped({
            prefix: "madar-desktop-client-settings-dotfiles-",
          });
          const linkedSettingsPath = `${dotfiles}/client-settings.json`;
          yield* fileSystem.writeFileString(linkedSettingsPath, "{}\n");
          yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
          yield* fileSystem.symlink(linkedSettingsPath, environment.clientSettingsPath);

          yield* settings.set(clientSettings);

          assert.equal(
            yield* fileSystem.readLink(environment.clientSettingsPath),
            linkedSettingsPath,
          );
          assert.deepEqual(
            yield* decodeClientSettingsJson(yield* fileSystem.readFileString(linkedSettingsPath)),
            clientSettings,
          );
        }),
      ),
  );

  it.effect.each([
    { label: "permission", reason: "PermissionDenied" },
    { label: "I/O", reason: "Unknown" },
  ] as const)("preserves saved preferences across $label read failures and retries", (failure) =>
    withClientSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopClientSettings.DesktopClientSettings;
        const savedSettings = {
          ...clientSettings,
          confirmQuit: "direct" as const,
        };
        yield* settings.set(savedSettings);
        const savedContents = yield* fileSystem.readFileString(environment.clientSettingsPath);
        const cause = PlatformError.systemError({
          _tag: failure.reason,
          module: "FileSystem",
          method: "readFileString",
          pathOrDescriptor: environment.clientSettingsPath,
        });
        let failRead = true;
        const retryableSettings = yield* DesktopClientSettings.make.pipe(
          Effect.provideService(
            FileSystem.FileSystem,
            FileSystem.FileSystem.of({
              ...fileSystem,
              readFileString: (path) =>
                Effect.suspend(() =>
                  failRead ? Effect.fail(cause) : fileSystem.readFileString(path),
                ),
            }),
          ),
        );

        const error = yield* retryableSettings.get.pipe(Effect.flip);
        assert.instanceOf(error, DesktopClientSettings.DesktopClientSettingsReadError);
        assert.equal(error.operation, "read-file");
        assert.equal(error.path, environment.clientSettingsPath);
        assert.strictEqual(error.cause, cause);
        assert.equal(
          yield* fileSystem.readFileString(environment.clientSettingsPath),
          savedContents,
        );

        failRead = false;
        assert.deepEqual(yield* retryableSettings.get, Option.some(savedSettings));
      }),
    ),
  );

  it.effect("loads lenient direct client settings documents", () =>
    withClientSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopClientSettings.DesktopClientSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          environment.clientSettingsPath,
          `{
            // Matches server settings parsing.
            "confirmQuit": "double-click",
          }\n`,
        );

        const persisted = yield* settings.get;
        assert.isTrue(Option.isSome(persisted));
        if (Option.isSome(persisted)) {
          assert.equal(persisted.value.confirmQuit, "double-click");
        }
      }),
    ),
  );

  it.effect("loads legacy wrapped client settings documents", () =>
    withClientSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopClientSettings.DesktopClientSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          environment.clientSettingsPath,
          `{
            "settings": {
              "confirmQuit": "direct"
            }
          }\n`,
        );

        const persisted = yield* settings.get;
        assert.isTrue(Option.isSome(persisted));
        if (Option.isSome(persisted)) {
          assert.equal(persisted.value.confirmQuit, "direct");
        }
      }),
    ),
  );

  it.effect.each([
    { label: "malformed JSON", contents: "{not-json" },
    { label: "invalid legacy settings", contents: '{"settings":{"confirmQuit":"invalid"}}' },
  ])("reports $label without treating the settings file as absent", (document) =>
    withClientSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopClientSettings.DesktopClientSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(environment.clientSettingsPath, document.contents);

        const error = yield* settings.get.pipe(Effect.flip);
        assert.instanceOf(error, DesktopClientSettings.DesktopClientSettingsReadError);
        assert.equal(error.operation, "decode-document");
        assert.equal(error.path, environment.clientSettingsPath);
        assert.instanceOf(error.cause, Schema.SchemaError);
        assert.equal(
          yield* fileSystem.readFileString(environment.clientSettingsPath),
          document.contents,
        );
      }),
    ),
  );
});

it.effect("saves the quit preference without carrying retired coding settings forward", () =>
  withClientSettings(
    Effect.gen(function* () {
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      const fileSystem = yield* FileSystem.FileSystem;
      const settings = yield* DesktopClientSettings.DesktopClientSettings;
      yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
      yield* fileSystem.writeFileString(
        environment.clientSettingsPath,
        '{"confirmQuit":"direct","diffLayout":"split","providerModelPreferences":{}}',
      );
      const persisted = yield* settings.get;
      assert.isTrue(Option.isSome(persisted));
      if (Option.isSome(persisted)) {
        assert.equal(persisted.value.confirmQuit, "direct");
        assert.isFalse(Object.hasOwn(persisted.value, "diffLayout"));
        yield* settings.set(persisted.value);
        assert.deepEqual(
          JSON.parse(yield* fileSystem.readFileString(environment.clientSettingsPath)),
          { confirmQuit: "direct" },
        );
      }
    }),
  ),
);
