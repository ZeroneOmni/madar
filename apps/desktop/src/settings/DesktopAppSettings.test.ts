import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopAppSettings from "./DesktopAppSettings.ts";

const DesktopSettingsPatch = Schema.Struct({
  linuxPasswordStore: Schema.optionalKey(
    Schema.Literals(["auto", "gnome-libsecret", "kwallet", "kwallet5", "kwallet6"]),
  ),
  mainWindowBounds: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({
        x: Schema.Number,
        y: Schema.Number,
        width: Schema.Number,
        height: Schema.Number,
      }),
    ),
  ),
  mainWindowMaximized: Schema.optionalKey(Schema.Boolean),

  updateChannel: Schema.optionalKey(Schema.Literals(["latest", "nightly"])),
  updateChannelConfiguredByUser: Schema.optionalKey(Schema.Boolean),
});

const decodeDesktopSettingsPatch = Schema.decodeEffect(Schema.fromJsonString(DesktopSettingsPatch));
const encodeDesktopSettingsPatch = Schema.encodeEffect(Schema.fromJsonString(DesktopSettingsPatch));

function layerEnvironment(baseDir: string, appVersion = "0.0.17") {
  return DesktopEnvironment.layer({
    dirname: "/repo/apps/desktop/src",
    homeDirectory: baseDir,
    platform: "darwin",
    processArch: "x64",
    appVersion,
    appPath: "/repo",
    isPackaged: true,
    resourcesPath: "/missing/resources",
    runningUnderArm64Translation: false,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ MADAR_HOME: baseDir })),
    ),
  );
}

const withSettings = <A, E, R>(
  effect: Effect.Effect<
    A,
    E,
    R | DesktopAppSettings.DesktopAppSettings | DesktopEnvironment.DesktopEnvironment
  >,
  options?: { readonly appVersion?: string },
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "t3-desktop-settings-test-",
    });
    return yield* effect.pipe(
      Effect.provide(
        DesktopAppSettings.layer.pipe(
          Layer.provideMerge(layerEnvironment(baseDir, options?.appVersion)),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

function writeSettingsPatch(patch: typeof DesktopSettingsPatch.Type) {
  return Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const encoded = yield* encodeDesktopSettingsPatch(patch);
    yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
    yield* fileSystem.writeFileString(environment.desktopSettingsPath, `${encoded}\n`);
  });
}

describe("DesktopSettings", () => {
  it.effect("falls back to defaults when the settings file is malformed", () =>
    withSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(environment.desktopSettingsPath, "{not-json");

        assert.deepEqual(yield* settings.load, DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS);
      }),
    ),
  );

  it.effect("loads lenient persisted desktop settings JSON", () =>
    withSettings(
      Effect.gen(function* () {
        const environment = yield* DesktopEnvironment.DesktopEnvironment;
        const fileSystem = yield* FileSystem.FileSystem;
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* fileSystem.makeDirectory(environment.stateDir, { recursive: true });
        yield* fileSystem.writeFileString(
          environment.desktopSettingsPath,
          `{
            // JSONC-style comments and trailing commas match server settings parsing.
            "serverExposureMode": "network-accessible",
            "tailscaleServeEnabled": true,
            "tailscaleServePort": 8443,
            "mainWindowBounds": { "x": 120, "y": 80, "width": 1280, "height": 900 },
          }\n`,
        );

        assert.deepEqual(yield* settings.load, {
          linuxPasswordStore: "auto",
          localEnvironmentEnabled: true,
          mainWindowBounds: { x: 120, y: 80, width: 1280, height: 900 },
          mainWindowMaximized: false,

          updateChannel: "latest",
          updateChannelConfiguredByUser: false,
        } satisfies DesktopAppSettings.DesktopSettings);
      }),
    ),
  );

  it.effect("rejects window bounds that do not satisfy the domain schema", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* writeSettingsPatch({
          mainWindowBounds: { x: 10.5, y: 20, width: 839, height: 620 },
          mainWindowMaximized: true,
        });

        const loaded = yield* settings.load;
        assert.isNull(loaded.mainWindowBounds);
        assert.isFalse(loaded.mainWindowMaximized);
      }),
    ),
  );

  it.effect("migrates legacy implicit update channels to the runtime default", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* writeSettingsPatch({
          updateChannel: "latest",
        });

        assert.deepEqual(yield* settings.load, {
          linuxPasswordStore: "auto",
          localEnvironmentEnabled: true,
          mainWindowBounds: null,
          mainWindowMaximized: false,

          updateChannel: "nightly",
          updateChannelConfiguredByUser: false,
        } satisfies DesktopAppSettings.DesktopSettings);
      }),
      { appVersion: "0.0.17-nightly.20260415.1" },
    ),
  );

  it.effect("preserves explicit stable update channel on nightly builds", () =>
    withSettings(
      Effect.gen(function* () {
        const settings = yield* DesktopAppSettings.DesktopAppSettings;
        yield* writeSettingsPatch({
          updateChannel: "latest",
          updateChannelConfiguredByUser: true,
        });

        assert.deepEqual(yield* settings.load, {
          linuxPasswordStore: "auto",
          localEnvironmentEnabled: true,
          mainWindowBounds: null,
          mainWindowMaximized: false,

          updateChannel: "latest",
          updateChannelConfiguredByUser: true,
        } satisfies DesktopAppSettings.DesktopSettings);
      }),
      { appVersion: "0.0.17-nightly.20260415.1" },
    ),
  );
});
