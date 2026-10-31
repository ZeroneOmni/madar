import type { DesktopBridge } from "@madar/contracts";
import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";

import * as IpcChannels from "./ipc/channels.ts";
// oxlint-disable-next-line madar/no-global-process-runtime -- Electron exposes the client platform in its sandboxed preload process.
const clientPlatform = process.platform;

if (clientPlatform === "darwin") {
  // Native buttons ignore Chromium zoom; reserve native points even after reload.
  const syncWindowControlInset = () => {
    document.documentElement.style.setProperty(
      "--desktop-window-controls-inset",
      `${90 / webFrame.getZoomFactor()}px`,
    );
  };
  window.addEventListener("DOMContentLoaded", syncWindowControlInset, { once: true });
  window.addEventListener("resize", syncWindowControlInset);
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getAppBranding"]>;
  },
  getRelayTelemetryEnabled: () =>
    ipcRenderer.sendSync(IpcChannels.GET_RELAY_TELEMETRY_ENABLED_CHANNEL) === true,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getClientPlatform: () => clientPlatform,
  setNotificationBadge: (badge) =>
    ipcRenderer.invoke(IpcChannels.SET_NOTIFICATION_BADGE_CHANNEL, badge),
  onNotificationBadgeClear: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IpcChannels.SET_NOTIFICATION_BADGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.SET_NOTIFICATION_BADGE_CHANNEL, handler);
  },
  onTrackpadScrollEnd: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IpcChannels.TRACKPAD_SCROLL_END_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.TRACKPAD_SCROLL_END_CHANNEL, handler);
  },
  revealWindow: () => ipcRenderer.invoke(IpcChannels.REVEAL_WINDOW_CHANNEL),
  getSystemLocale: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_SYSTEM_LOCALE_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  getLocalEnvironmentBootstraps: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL);
    if (!Array.isArray(result)) {
      return [];
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstraps"]>;
  },
  getLocalEnvironmentBearerToken: () =>
    ipcRenderer.invoke(IpcChannels.GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL),
  getLocalEnvironmentEnabled: () =>
    ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL) !== false,
  setLocalEnvironmentEnabled: (enabled) =>
    ipcRenderer.invoke(IpcChannels.SET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL, enabled),
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.SET_CLIENT_SETTINGS_CHANNEL, settings),

  getConnectionCatalog: () => ipcRenderer.invoke(IpcChannels.GET_CONNECTION_CATALOG_CHANNEL),
  setConnectionCatalog: (catalog) =>
    ipcRenderer.invoke(IpcChannels.SET_CONNECTION_CATALOG_CHANNEL, catalog),
  clearConnectionCatalog: () => ipcRenderer.invoke(IpcChannels.CLEAR_CONNECTION_CATALOG_CHANNEL),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.PICK_FOLDER_CHANNEL, options),
  pickProjectFavicon: (initialPath) =>
    ipcRenderer.invoke(IpcChannels.PICK_PROJECT_FAVICON_CHANNEL, initialPath),
  pickThemeFiles: () => ipcRenderer.invoke(IpcChannels.PICK_THEME_FILES_CHANNEL, undefined),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_CHANNEL, {
      items,
      ...(position === undefined ? {} : { position }),
    }),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),

  openSystemSettings: (pane: string) =>
    ipcRenderer.invoke(IpcChannels.OPEN_SYSTEM_SETTINGS_CHANNEL, pane),
  pasteAsText: () => ipcRenderer.invoke(IpcChannels.PASTE_AS_TEXT_CHANNEL, undefined),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },

  onQuitShortcut: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, hint: unknown) => {
      if (typeof hint !== "object" || hint === null || !("state" in hint)) return;
      if (hint.state === "up") {
        listener({ state: "up" });
        return;
      }
      if (
        hint.state === "down" &&
        "mode" in hint &&
        (hint.mode === "hold" || hint.mode === "double-click")
      ) {
        listener({ state: "down", mode: hint.mode });
      }
    };

    ipcRenderer.on(IpcChannels.QUIT_SHORTCUT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.QUIT_SHORTCUT_CHANNEL, wrappedListener);
    };
  },
  getWindowFullscreenState: () =>
    ipcRenderer.sendSync(IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL) === true,
  getWindowZoomFactor: () => webFrame.getZoomFactor(),
  onWindowFullscreenStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => {
      if (typeof fullscreen !== "boolean") return;
      listener(fullscreen);
    };

    ipcRenderer.on(IpcChannels.WINDOW_FULLSCREEN_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.WINDOW_FULLSCREEN_STATE_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL_CHANNEL, channel),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL_CHANNEL),
  cliCommand: {
    getState: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_GET_STATE_CHANNEL),
    install: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_INSTALL_CHANNEL),
    uninstall: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_UNINSTALL_CHANNEL),
  },
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  webLinks: {
    setReady: (ready) => ipcRenderer.invoke(IpcChannels.WEB_LINK_READY_CHANNEL, ready),
    onOpen: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, url: unknown) => {
        if (typeof url === "string") listener(url);
      };
      ipcRenderer.on(IpcChannels.WEB_LINK_OPEN_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.WEB_LINK_OPEN_CHANNEL, wrappedListener);
      };
    },
  },
  appActivation: {
    setReady: (ready) =>
      ipcRenderer.invoke(IpcChannels.DESKTOP_APP_ACTIVATION_READY_CHANNEL, ready),
    complete: (response) =>
      ipcRenderer.invoke(IpcChannels.DESKTOP_APP_ACTIVATION_COMPLETE_CHANNEL, response),
    onRequest: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        if (typeof request !== "object" || request === null) return;
        listener(request as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IpcChannels.DESKTOP_APP_ACTIVATION_REQUEST_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(
          IpcChannels.DESKTOP_APP_ACTIVATION_REQUEST_CHANNEL,
          wrappedListener,
        );
      };
    },
  },
} satisfies DesktopBridge);
