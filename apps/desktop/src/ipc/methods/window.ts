import {
  ContextMenuItemSchema,
  DesktopAppBrandingSchema,
  DesktopEnvironmentBootstrapSchema,
  DesktopThemeSchema,
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  SystemSettingsPaneSchema,
  type DesktopEnvironmentBootstrap,
} from "@madar/contracts";
import * as HostProcess from "@madar/shared/HostProcess";
import { isRelayTracingEnabled } from "@madar/shared/otelEnvironment";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopBackendConfiguration from "../../backend/DesktopBackendConfiguration.ts";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "../../backend/DesktopLocalEnvironmentAuth.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as ElectronMenu from "../../electron/ElectronMenu.ts";
import * as ElectronShell from "../../electron/ElectronShell.ts";
import * as ElectronTheme from "../../electron/ElectronTheme.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as Electron from "electron";
import * as MacPermissions from "../../permissions/MacPermissions.ts";

import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const ContextMenuPosition = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
});

const ContextMenuInput = Schema.Struct({
  items: Schema.Array(ContextMenuItemSchema),
  position: Schema.optionalKey(ContextMenuPosition),
});

function toWebSocketBaseUrl(httpBaseUrl: URL): string {
  const url = new URL(httpBaseUrl.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

export const getAppBranding = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_APP_BRANDING_CHANNEL,
  result: Schema.NullOr(DesktopAppBrandingSchema),
  handler: Effect.fn("desktop.ipc.window.getAppBranding")(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    return environment.branding;
  }),
});

export const getRelayTelemetryEnabled = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_RELAY_TELEMETRY_ENABLED_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.getRelayTelemetryEnabled")(function* () {
    return isRelayTracingEnabled(yield* HostProcess.Environment);
  }),
});

export const getSystemLocale = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_SYSTEM_LOCALE_CHANNEL,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.window.getSystemLocale")(function* () {
    const electronApp = yield* ElectronApp.ElectronApp;
    return yield* electronApp.systemLocale;
  }),
});

export const getWindowFullscreenState = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.getWindowFullscreenState")(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.currentMainOrFirst;
    return Option.isSome(window) && window.value.isFullScreen();
  }),
});

export const getLocalEnvironmentBootstraps = DesktopIpc.makeSyncIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL,
  result: Schema.Array(DesktopEnvironmentBootstrapSchema),
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBootstraps")(function* () {
    const pool = yield* DesktopBackendPool.DesktopBackendPool;
    const configuration = yield* DesktopBackendConfiguration.DesktopBackendConfiguration;
    const instances = yield* pool.list;
    const bootstraps: DesktopEnvironmentBootstrap[] = [];
    for (const instance of instances) {
      const isPrimary = instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID;
      const config = yield* instance.currentConfig;
      const snapshot = yield* instance.snapshot;
      if (Option.isNone(config) || Option.isSome(config.value.preflightFailure)) {
        const fatalPreflight =
          Option.isSome(config) &&
          Option.isSome(config.value.preflightFailure) &&
          config.value.preflightFailure.value.fatal;
        const stoppedPreflight =
          Option.isSome(config) &&
          Option.isSome(config.value.preflightFailure) &&
          (!snapshot.desiredRunning || !snapshot.restartScheduled);
        if (isPrimary || fatalPreflight || stoppedPreflight) continue;
        bootstraps.push({
          id: instance.id,
          label: yield* instance.label,
          httpBaseUrl: null,
          wsBaseUrl: null,
        });
        continue;
      }
      const { bootstrap, httpBaseUrl } = config.value;
      bootstraps.push({
        id: instance.id,
        label: yield* instance.label,
        httpBaseUrl: httpBaseUrl.href,
        wsBaseUrl: toWebSocketBaseUrl(httpBaseUrl),
        // Use the current window's derived token; the launch config's token may be stale.
        ...(bootstrap.desktopBootstrapSecret
          ? { bootstrapToken: yield* configuration.currentBootstrapToken }
          : bootstrap.desktopBootstrapToken
            ? { bootstrapToken: bootstrap.desktopBootstrapToken }
            : {}),
      });
    }
    return bootstraps;
  }),
});

export const getLocalEnvironmentBearerToken = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL,
  payload: Schema.Void,
  result: Schema.String,
  handler: Effect.fn("desktop.ipc.window.getLocalEnvironmentBearerToken")(function* () {
    const localAuth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
    return yield* localAuth.getBearerToken;
  }),
});

export const setTheme = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.SET_THEME_CHANNEL,
  payload: DesktopThemeSchema,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.setTheme")(function* (theme) {
    const electronTheme = yield* ElectronTheme.ElectronTheme;
    yield* electronTheme.setSource(theme);
  }),
});

export const showContextMenu = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.CONTEXT_MENU_CHANNEL,
  payload: ContextMenuInput,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.window.showContextMenu")(function* (input) {
    const electronMenu = yield* ElectronMenu.ElectronMenu;
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.focusedMainOrFirst;
    if (Option.isNone(window)) {
      return null;
    }

    const selectedItemId = yield* electronMenu.showContextMenu({
      window: window.value,
      items: input.items,
      position: Option.fromNullishOr(input.position),
    });
    return Option.getOrNull(selectedItemId);
  }),
});

export const openExternal = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_EXTERNAL_CHANNEL,
  payload: Schema.String,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openExternal")(function* (url) {
    const shell = yield* ElectronShell.ElectronShell;
    return yield* shell.openExternal(url);
  }),
});

export const openSystemSettings = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.OPEN_SYSTEM_SETTINGS_CHANNEL,
  payload: SystemSettingsPaneSchema,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.window.openSystemSettings")(function* (pane) {
    const shell = yield* ElectronShell.ElectronShell;
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    if (environment.platform !== "darwin") return false;
    const owner = Electron.BrowserWindow.getFocusedWindow();
    const opened = yield* shell.openSystemSettings(pane);
    if (opened && environment.isPackaged) {
      const permissions = yield* MacPermissions.MacPermissions;

      yield* permissions.showHelper(pane, owner);
    }
    return opened;
  }),
});

export const pasteAsText = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.PASTE_AS_TEXT_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.pasteAsText")(function* (_input, event) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.main;
    if (
      event === undefined ||
      Option.isNone(window) ||
      window.value.isDestroyed() ||
      window.value.webContents.id !== event.sender.id
    ) {
      return;
    }
    const focused = Electron.webContents.getFocusedWebContents();
    if (
      focused &&
      !focused.isDestroyed() &&
      Electron.BrowserWindow.fromWebContents(focused) === window.value
    ) {
      focused.paste();
    }
  }),
});

export const revealWindow = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.REVEAL_WINDOW_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.Void,
  handler: Effect.fn("desktop.ipc.window.revealWindow")(function* (_input, event) {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const window = yield* electronWindow.main;
    if (
      event === undefined ||
      Option.isNone(window) ||
      window.value.webContents.id !== event.sender.id
    ) {
      return;
    }
    yield* electronWindow.reveal(window.value);
  }),
});
