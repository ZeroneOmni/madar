import packageJson from "../../package.json" with { type: "json" };
import { SERVICE_LAUNCHER_PROTOCOL } from "./serviceProtocol.ts";

export type ServicePreflightResult =
  | {
      readonly status: "ready";
      readonly version: string;
      readonly launcherProtocol: typeof SERVICE_LAUNCHER_PROTOCOL;
    }
  | {
      readonly status: "blocked";
      readonly version: string;
      readonly reason: string;
    };

export function runServicePreflight(input: {
  readonly databasePath: string;
  readonly launcherProtocol: number;
  readonly version?: string;
}): ServicePreflightResult {
  const version = input.version ?? packageJson.version;
  if (input.launcherProtocol !== SERVICE_LAUNCHER_PROTOCOL) {
    return {
      status: "blocked",
      version,
      // A stale `madar` earlier on PATH (an old npm/nvm global) makes `madar service install`
      // reinstall itself and report success, so name the exact install and the path check.
      reason: [
        `The installed service launcher speaks protocol ${input.launcherProtocol}, but madar@${version} requires protocol ${SERVICE_LAUNCHER_PROTOCOL}.`,
        `On the server machine, install this exact CLI: \`curl -fsSL https://raw.githubusercontent.com/ZeroneOmni/madar/main/scripts/install.sh | MADAR_VERSION=${version} sh\`.`,
        `Check that \`madar --version\` prints ${version} and that \`which -a madar\` lists no older madar (such as an npm or nvm install) first, then run \`~/.local/bin/madar service install\` (the installer's default path).`,
        "Updating the desktop app does not update this CLI, and `madar service update` only repairs the service with whichever CLI runs it.",
      ].join(" "),
    };
  }

  return { status: "ready", version, launcherProtocol: SERVICE_LAUNCHER_PROTOCOL };
}
