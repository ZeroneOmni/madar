import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  getLocalEnvironmentEnabled,
  setLocalEnvironmentEnabled,
} from "./methods/localEnvironment.ts";
import {
  checkForUpdate,
  downloadUpdate,
  getUpdateState,
  installUpdate,
  setUpdateChannel,
} from "./methods/updates.ts";
import {
  getAppBranding,
  getLocalEnvironmentBootstraps,
  getLocalEnvironmentBearerToken,
  getRelayTelemetryEnabled,
  getSystemLocale,
  getWindowFullscreenState,
  openExternal,
  openSystemSettings,
  pasteAsText,
  revealWindow,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";

import {
  getCliCommandState,
  installCliCommand,
  uninstallCliCommand,
} from "./methods/cliCommand.ts";

export const installDesktopIpcHandlers = Effect.fn("desktop.ipc.installHandlers")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getRelayTelemetryEnabled);
  yield* ipc.handleSync(getSystemLocale);
  yield* ipc.handleSync(getWindowFullscreenState);
  yield* ipc.handleSync(getLocalEnvironmentBootstraps);
  yield* ipc.handleSync(getLocalEnvironmentEnabled);
  yield* ipc.handle(setLocalEnvironmentEnabled);
  yield* ipc.handle(getLocalEnvironmentBearerToken);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);

  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openSystemSettings);

  yield* ipc.handle(pasteAsText);
  yield* ipc.handle(revealWindow);
  yield* ipc.handle(getUpdateState);
  yield* ipc.handle(setUpdateChannel);
  yield* ipc.handle(downloadUpdate);
  yield* ipc.handle(installUpdate);
  yield* ipc.handle(checkForUpdate);
  yield* ipc.handle(getCliCommandState);
  yield* ipc.handle(installCliCommand);
  yield* ipc.handle(uninstallCliCommand);
});
