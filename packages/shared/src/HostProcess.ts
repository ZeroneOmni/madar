import * as Context from "effect/Context";

import * as NodeOS from "node:os";
import * as NodeSea from "node:sea";

export const Platform = Context.Reference<NodeJS.Platform>("@madar/shared/HostProcess/Platform", {
  defaultValue: () => process.platform,
});

export const Architecture = Context.Reference<NodeJS.Architecture>(
  "@madar/shared/HostProcess/Architecture",
  {
    defaultValue: () => process.arch,
  },
);

export const Hostname = Context.Reference<string>("@madar/shared/HostProcess/Hostname", {
  defaultValue: () => NodeOS.hostname(),
});

export const HomeDirectory = Context.Reference<string>("@madar/shared/HostProcess/HomeDirectory", {
  defaultValue: () => NodeOS.homedir(),
});

export const Environment = Context.Reference<NodeJS.ProcessEnv>(
  "@madar/shared/HostProcess/Environment",
  {
    defaultValue: () => process.env,
  },
);

export const WorkingDirectory = Context.Reference<string>(
  "@madar/shared/HostProcess/WorkingDirectory",
  {
    defaultValue: () => process.cwd(),
  },
);

export const ExecutablePath = Context.Reference<string>(
  "@madar/shared/HostProcess/ExecutablePath",
  {
    defaultValue: () => process.execPath,
  },
);

export const Arguments = Context.Reference<ReadonlyArray<string>>(
  "@madar/shared/HostProcess/Arguments",
  {
    defaultValue: () => process.argv,
  },
);

/** Original shell command spelling; argv[0] and execPath instead identify the resolved binary. */
export const InvokedAs = Context.Reference<string>("@madar/shared/HostProcess/InvokedAs", {
  defaultValue: () => process.argv0,
});

export const IsExecutable = Context.Reference<boolean>("@madar/shared/HostProcess/IsExecutable", {
  defaultValue: () => NodeSea.isSea(),
});

/** Includes hostname-resolved addresses absent from interfaces, such as Debian's 127.0.1.1 used by Firefox locks. */

export const UserId = Context.Reference<number | undefined>("@madar/shared/HostProcess/UserId", {
  defaultValue: () => process.getuid?.(),
});
