// @effect-diagnostics nodeBuiltinImport:off - the Windows launch smoke tests use filesystem notifications to observe real PowerShell launches.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import * as HostProcess from "@madar/shared/HostProcess";
import { SpawnExecutableResolution } from "@madar/shared/shell";
import * as ExternalLauncher from "./externalLauncher.ts";

interface MockSpawnResult {
  readonly spawnError?: PlatformError.PlatformError;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stall?: boolean;
}

function makeMockDetachedHandle(input: MockSpawnResult & { readonly onUnref?: () => void } = {}) {
  return ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: input.stall
      ? Effect.never
      : Effect.succeed(ChildProcessSpawner.ExitCode(input.exitCode ?? 0)),
    isRunning: Effect.succeed(true),
    kill: () => Effect.void,
    unref: Effect.sync(() => {
      input.onUnref?.();
      return Effect.void;
    }),
    stdin: Sink.drain,
    stdout:
      input.stdout === undefined
        ? Stream.empty
        : Stream.make(new TextEncoder().encode(input.stdout)),
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });
}

const layerTest = (input: {
  readonly platform: NodeJS.Platform;
  readonly env?: Record<string, string>;
  readonly resolveExecutable?: (command: string) => string | undefined;
  readonly onSpawn?: (command: ChildProcess.StandardCommand) => void;
  readonly onUnref?: () => void;
  readonly spawnResult?: (command: ChildProcess.StandardCommand) => MockSpawnResult | undefined;
}) => {
  const layerSpawner = Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.gen(function* () {
        assert.equal(ChildProcess.isStandardCommand(command), true);
        if (!ChildProcess.isStandardCommand(command)) {
          throw new Error("Expected a standard command");
        }
        input.onSpawn?.(command);
        const result = input.spawnResult?.(command);
        if (result?.spawnError) return yield* result.spawnError;
        return makeMockDetachedHandle({
          ...(input.onUnref === undefined ? {} : { onUnref: input.onUnref }),
          ...result,
        });
      }),
    ),
  );

  return Layer.mergeAll(
    ExternalLauncher.layer.pipe(Layer.provide(Layer.merge(NodeServices.layer, layerSpawner))),
    Layer.succeed(HostProcess.Platform, input.platform),
    Layer.succeed(
      SpawnExecutableResolution,
      (command) => input.resolveExecutable?.(command) ?? command,
    ),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} })),
  );
};

it.effect.each([
  { platform: "darwin" as const, command: "open" },
  { platform: "linux" as const, command: "xdg-open" },
  {
    platform: "win32" as const,
    command: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
  },
])("opens a browser on $platform without inheriting Electron mode", ({ platform, command }) =>
  Effect.gen(function* () {
    const spawned: ChildProcess.StandardCommand[] = [];
    let unreferenced = false;
    yield* Effect.gen(function* () {
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      yield* launcher.launchBrowser("https://example.com/path?q=hello");
    }).pipe(
      Effect.provide(
        layerTest({
          platform,
          onSpawn: (value) => spawned.push(value),
          onUnref: () => {
            unreferenced = true;
          },
        }),
      ),
      Effect.provideService(HostProcess.Environment, { ELECTRON_RUN_AS_NODE: "1", PATH: "/bin" }),
    );
    assert.equal(spawned.length, 1);
    assert.equal(spawned[0]?.command, command);
    assert.deepEqual(spawned[0]?.options.env, { PATH: "/bin" });
    assert.equal(spawned[0]?.options.extendEnv, false);
    assert.equal(unreferenced, true);
    if (platform === "win32") {
      const encoded = spawned[0]?.args.at(-1) ?? "";
      assert.equal(
        Buffer.from(encoded, "base64").toString("utf16le"),
        "$ProgressPreference = 'SilentlyContinue'; Start 'https://example.com/path?q=hello'",
      );
    } else {
      assert.deepEqual(spawned[0]?.args, ["https://example.com/path?q=hello"]);
    }
  }),
);
