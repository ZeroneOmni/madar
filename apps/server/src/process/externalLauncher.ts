import { ExternalLauncherBrowserSpawnError } from "@madar/contracts";
import * as HostProcess from "@madar/shared/HostProcess";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Base64 from "effect/encoding/Base64";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export { ExternalLauncherBrowserSpawnError } from "@madar/contracts";
interface ProcessLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: ChildProcess.CommandOptions;
}

const POWERSHELL_ARGUMENTS_PREFIX = [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-EncodedCommand",
] as const;

const DETACHED_IGNORE_STDIO_OPTIONS = {
  detached: true,
  stdin: "ignore",
  stdout: "ignore",
  stderr: "ignore",
} as const satisfies ChildProcess.CommandOptions;

const compactEnv = (input: Record<string, Option.Option<string>>): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(input).flatMap(([key, value]) =>
      Option.match(value, {
        onNone: () => [],
        onSome: (resolved) => [[key, resolved]],
      }),
    ),
  );

const BrowserLaunchEnvConfig = Config.all({
  SYSTEMROOT: Config.String("SYSTEMROOT").pipe(Config.option),
  windir: Config.String("windir").pipe(Config.option),
}).pipe(Config.map(compactEnv));

const readBrowserLaunchEnv = BrowserLaunchEnvConfig.pipe(Effect.orElseSucceed(() => ({})));

function encodeUtf16LeBase64(input: string): string {
  const bytes = new Uint8Array(input.length * 2);
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  return Base64.encode(bytes);
}

function escapePowerShellStringLiteral(input: string): string {
  return `'${input.replaceAll("'", "''")}'`;
}

function resolvePowerShellPath(env: NodeJS.ProcessEnv = {}): string {
  return `${env.SYSTEMROOT || env.windir || String.raw`C:\Windows`}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
}

function resolveWindowsBrowserLaunch(target: string, command: string): ProcessLaunch {
  const encodedCommand = encodeUtf16LeBase64(
    `$ProgressPreference = 'SilentlyContinue'; Start ${escapePowerShellStringLiteral(target)}`,
  );
  return {
    command,
    args: [...POWERSHELL_ARGUMENTS_PREFIX, encodedCommand],
    options: {
      // Detached PowerShell can exit without executing the command.
      detached: false,
      shell: false,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  };
}

function buildBrowserLaunch(
  target: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): ProcessLaunch {
  if (platform === "darwin") {
    return {
      command: "open",
      args: [target],
      options: DETACHED_IGNORE_STDIO_OPTIONS,
    };
  }

  if (platform === "win32") {
    return resolveWindowsBrowserLaunch(target, resolvePowerShellPath(env));
  }

  return {
    command: "xdg-open",
    args: [target],
    options: DETACHED_IGNORE_STDIO_OPTIONS,
  };
}

const resolveBrowserLaunch = Effect.fn("externalLauncher.resolveBrowserLaunch")(function* (
  target: string,
) {
  const platform = yield* HostProcess.Platform;
  const env = yield* readBrowserLaunchEnv;
  return buildBrowserLaunch(target, platform, env);
});

const launchAndUnref = Effect.fn("externalLauncher.launchAndUnref")(function* (
  launch: ProcessLaunch,
  onError: (cause: unknown) => ExternalLauncherBrowserSpawnError,
): Effect.fn.Return<
  void,
  ExternalLauncherBrowserSpawnError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  // Inherited ELECTRON_RUN_AS_NODE would make Electron apps opened by this launcher run as Node and exit.
  const { ELECTRON_RUN_AS_NODE: _runAsNode, ...env } = yield* HostProcess.Environment;
  const command = ChildProcess.make(launch.command, launch.args, {
    ...launch.options,
    env,
    extendEnv: false,
  });

  yield* spawner.spawn(command).pipe(
    Effect.flatMap((handle) => handle.unref),
    Effect.asVoid,
    Effect.scoped,
    Effect.mapError(onError),
  );
});

const launchBrowser = Effect.fn("externalLauncher.launchBrowser")(function* (
  target: string,
): Effect.fn.Return<
  void,
  ExternalLauncherBrowserSpawnError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  const launch = yield* resolveBrowserLaunch(target);
  return yield* launchAndUnref(
    launch,
    (cause) =>
      new ExternalLauncherBrowserSpawnError({
        target,
        command: launch.command,
        args: launch.args,
        cause,
      }),
  );
});

export class ExternalLauncher extends Context.Service<
  ExternalLauncher,
  {
    readonly launchBrowser: (
      target: string,
    ) => Effect.Effect<void, ExternalLauncherBrowserSpawnError>;
  }
>()("madar/process/externalLauncher") {}

export const layer = Layer.effect(
  ExternalLauncher,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    return ExternalLauncher.of({
      launchBrowser: (target) =>
        launchBrowser(target).pipe(
          Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
        ),
    });
  }),
);
