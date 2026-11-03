import { DesktopNotificationInput, DesktopNotificationResult } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";
import { deliverNotification } from "./notificationDelivery.ts";

export const notificationsSupported = DesktopIpc.makeIpcMethod({
  channel: Channels.NOTIFICATIONS_SUPPORTED_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.notifications.supported")(() =>
    Effect.sync(() => Electron.Notification.isSupported()),
  ),
});
export const showNotification = DesktopIpc.makeIpcMethod({
  channel: Channels.SHOW_NOTIFICATION_CHANNEL,
  payload: DesktopNotificationInput,
  result: DesktopNotificationResult,
  handler: Effect.fn("desktop.ipc.notifications.show")(function* (input) {
    const windows = yield* ElectronWindow.ElectronWindow;
    const current = yield* windows.currentMainOrFirst;
    const window = Option.getOrNull(current);
    return yield* Effect.promise(() =>
      deliverNotification(input, {
        supported: () => Electron.Notification.isSupported(),
        focused: () => window?.isFocused() ?? false,
        create: (value) =>
          new Electron.Notification({ title: value.title, body: value.message, silent: true }),
        activate: (path) => {
          if (!window || window.isDestroyed()) return;
          if (window.isMinimized()) window.restore();
          window.show();
          window.focus();
          window.webContents.send(Channels.NOTIFICATION_ACTIVATE_CHANNEL, path);
        },
      }),
    );
  }),
});
