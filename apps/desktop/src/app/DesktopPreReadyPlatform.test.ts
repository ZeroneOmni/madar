import { assert, describe, it } from "@effect/vitest";
import * as HostProcess from "@madar/shared/HostProcess";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const {
  appendSwitchMock,
  getSwitchValueMock,
  hasSwitchMock,
  registerSchemesMock,
  setDesktopNameMock,
  mkdirSyncMock,
  writeFileSyncMock,
  copyFileSyncMock,
  execFileSyncMock,
  readFileSyncMock,
} = vi.hoisted(() => ({
  appendSwitchMock: vi.fn(),
  getSwitchValueMock: vi.fn(),
  hasSwitchMock: vi.fn(),
  registerSchemesMock: vi.fn(),
  setDesktopNameMock: vi.fn(),
  mkdirSyncMock: vi.fn(),
  writeFileSyncMock: vi.fn(),
  copyFileSyncMock: vi.fn(),
  execFileSyncMock: vi.fn(),
  readFileSyncMock: vi.fn(),
}));

vi.mock("electron", () => ({
  app: {
    setDesktopName: setDesktopNameMock,
    getVersion: () => "0.0.37",
    isPackaged: true,
    getAppPath: () => "/tmp/.mount_T3/resources/app.asar",
    commandLine: {
      appendSwitch: appendSwitchMock,
      getSwitchValue: getSwitchValueMock,
      hasSwitch: hasSwitchMock,
    },
  },
  protocol: {
    registerSchemesAsPrivileged: registerSchemesMock,
  },
}));

vi.mock("node:fs", () => ({
  readFileSync: readFileSyncMock,
  mkdirSync: mkdirSyncMock,
  writeFileSync: writeFileSyncMock,
  copyFileSync: copyFileSyncMock,
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import * as DesktopPreReadyPlatform from "./DesktopPreReadyPlatform.ts";

describe("DesktopPreReadyPlatform", () => {
  beforeEach(() => {
    appendSwitchMock.mockReset();
    getSwitchValueMock.mockReset();
    hasSwitchMock.mockReset();
    registerSchemesMock.mockReset();
    setDesktopNameMock.mockReset();
    mkdirSyncMock.mockReset();
    writeFileSyncMock.mockReset();
    copyFileSyncMock.mockReset();
    execFileSyncMock.mockReset();
    readFileSyncMock.mockReset().mockReturnValue("{}");
  });

  it.effect("persists Linux scaling synchronously across relaunches and settings rewrites", () => {
    vi.stubEnv("MADAR_HOME", "/isolated");
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    const settingsPath = "/isolated/userdata/desktop-settings.json";
    const files = new Map([[settingsPath, "{}"]]);
    const commandLine = new Map<string, string>();
    readFileSyncMock.mockImplementation((path: string) => {
      const contents = files.get(path);
      if (contents === undefined) throw new Error("ENOENT");
      return contents;
    });
    writeFileSyncMock.mockImplementation((path: string, contents: string) => {
      files.set(path, contents);
    });
    hasSwitchMock.mockImplementation((name: string) => commandLine.has(name));
    getSwitchValueMock.mockImplementation((name: string) => commandLine.get(name) ?? "");
    appendSwitchMock.mockImplementation((name: string, value: string) => {
      commandLine.set(name, value);
    });
    const launch = Effect.gen(function* () {
      const startup = Promise.resolve().then(() => commandLine.get("force-device-scale-factor"));
      yield* DesktopPreReadyPlatform.make;
      return yield* Effect.promise(() => startup);
    });

    return Effect.gen(function* () {
      for (const explicitScale of ["1.75", "1"]) {
        commandLine.clear();
        commandLine.set("force-device-scale-factor", explicitScale);
        appendSwitchMock.mockClear();
        assert.equal(yield* launch, explicitScale);
        assert.isFalse(
          appendSwitchMock.mock.calls.some(([name]) => name === "force-device-scale-factor"),
        );

        // The settings service discards fields it does not own when rewriting its document.
        files.set(settingsPath, JSON.stringify({ linuxPasswordStore: "basic" }));
        commandLine.clear();
        assert.equal(yield* launch, explicitScale);
      }
    }).pipe(
      Effect.provideService(HostProcess.Platform, "linux"),
      Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())),
    );
  });

  it.effect.each([
    { previousEntry: undefined, label: "missing" },
    { previousEntry: 'Exec="/Applications/deleted-previous.AppImage" %U', label: "stale" },
  ])("prepares a $label Linux desktop entry before startup yields", ({ previousEntry }) => {
    vi.stubEnv("VITE_DEV_SERVER_URL", "");
    vi.stubEnv("XDG_DATA_HOME", "/xdg");
    vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
    getSwitchValueMock.mockReturnValue("");
    let desktopName = "madar.desktop";
    let desktopEntry = previousEntry;
    let iconInstalled = false;
    copyFileSyncMock.mockImplementation((_source: string, destination: string) => {
      iconInstalled = destination === "/xdg/icons/io.github.husseinbaraja.madar.desktop.png";
    });
    setDesktopNameMock.mockImplementation((name: string) => {
      desktopName = name;
    });
    writeFileSyncMock.mockImplementation((path: string, contents: string) => {
      if (path === "/xdg/applications/io.github.husseinbaraja.madar.desktop")
        desktopEntry = contents;
    });

    return Effect.scoped(
      Effect.gen(function* () {
        const portalIdentity = Promise.resolve().then(() => ({
          desktopName,
          desktopEntry,
          iconInstalled,
        }));
        yield* Layer.build(
          DesktopPreReadyPlatform.layer.pipe(
            Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
          ),
        );
        const identity = yield* Effect.promise(() => portalIdentity);
        assert.equal(identity.desktopName, "io.github.husseinbaraja.madar.desktop");
        assert.include(identity.desktopEntry ?? "", "Exec=/Applications/current.AppImage %U");
        assert.include(identity.desktopEntry ?? "", "Name=Madar (Beta)");
        assert.include(identity.desktopEntry ?? "", "MimeType=x-scheme-handler/madar;");
        assert.include(
          identity.desktopEntry ?? "",
          "Icon=/xdg/icons/io.github.husseinbaraja.madar.desktop.png",
        );
        assert.isTrue(identity.iconInstalled);
      }),
    ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
  });

  it.effect(
    "points the early portal entry at a configured distribution launcher with spaces",
    () => {
      vi.stubEnv("VITE_DEV_SERVER_URL", "");
      vi.stubEnv("XDG_DATA_HOME", "/xdg");
      vi.stubEnv("APPIMAGE", "/Applications/current.AppImage");
      vi.stubEnv("MADAR_DESKTOP_LAUNCHER_PATH", " /opt/Madar Desktop/madar ");
      getSwitchValueMock.mockReturnValue("");

      return Effect.scoped(
        Effect.gen(function* () {
          yield* Layer.build(
            DesktopPreReadyPlatform.layer.pipe(
              Layer.provide(Layer.succeed(HostProcess.Platform, "linux")),
            ),
          );
          const entry = writeFileSyncMock.mock.calls.find(
            ([path]) => path === "/xdg/applications/io.github.husseinbaraja.madar.desktop",
          )?.[1];
          assert.include(entry, 'Exec="/opt/Madar Desktop/madar" %U');
        }),
      ).pipe(Effect.ensuring(Effect.sync(() => vi.unstubAllEnvs())));
    },
  );
});
