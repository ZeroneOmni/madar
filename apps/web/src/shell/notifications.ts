import { translate } from "../locale";
import { readLocale } from "../useLocale";
import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import { toastManager } from "../components/ui/toast";
import { randomUUID } from "../lib/utils";

const KEY = "madar:shell-notifications";
const PREFERENCES_KEY = "madar:notification-preferences";
const CHANGE = "madar:notifications-change";
const DELIVERY = "madar:shell-notification";
const NotificationRecord = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  message: Schema.String,
  level: Schema.Literals(["success", "error", "info"]),
  path: Schema.String,
  createdAt: Schema.String,
  read: Schema.Boolean,
  desktopError: Schema.optionalKey(Schema.String),
});
const Inbox = Schema.Array(NotificationRecord);
const Preferences = Schema.Struct({ inApp: Schema.Boolean, desktop: Schema.Boolean });
const decodeHistory = Schema.decodeUnknownSync(Schema.fromJsonString(Inbox));
const decodePreferences = Schema.decodeUnknownSync(Schema.fromJsonString(Preferences));
type ShellNotification = typeof NotificationRecord.Type;
const DEFAULT_PREFERENCES = { inApp: true, desktop: false };

function read(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return "unavailable";
  }
}
function decodeInbox(serialized: string | null) {
  try {
    return { items: decodeHistory(serialized ?? "[]"), error: "" };
  } catch {
    return {
      items: [] as ReadonlyArray<ShellNotification>,
      error: "Notification history could not be read. Clear history to recover.",
    };
  }
}
function decodePreferenceValue(serialized: string | null) {
  try {
    return decodePreferences(serialized ?? JSON.stringify(DEFAULT_PREFERENCES));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event(CHANGE));
    return true;
  } catch {
    return false;
  }
}
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(CHANGE, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(CHANGE, listener);
  };
}
export function useNotificationInbox() {
  const serialized = useSyncExternalStore(
    subscribe,
    () => read(KEY),
    () => null,
  );
  return decodeInbox(serialized);
}
export function useNotificationPreferences() {
  const serialized = useSyncExternalStore(
    subscribe,
    () => read(PREFERENCES_KEY),
    () => null,
  );
  return decodePreferenceValue(serialized);
}
export function saveNotificationPreferences(value: typeof DEFAULT_PREFERENCES) {
  return write(PREFERENCES_KEY, value);
}
export function updateNotification(
  id: string,
  changes: Partial<Pick<ShellNotification, "read" | "desktopError">>,
) {
  return write(
    KEY,
    decodeInbox(read(KEY)).items.map((item) => (item.id === id ? { ...item, ...changes } : item)),
  );
}
export function dismissNotification(id: string) {
  return write(
    KEY,
    decodeInbox(read(KEY)).items.filter((item) => item.id !== id),
  );
}
export function clearNotifications() {
  return write(KEY, []);
}
export function notifyShell(input: {
  title: string;
  message?: string;
  level: "success" | "error" | "info";
  path?: string;
}) {
  const item: ShellNotification = {
    id: randomUUID(),
    title: input.title.slice(0, 160),
    message: (input.message ?? "").slice(0, 2000),
    level: input.level,
    path: /^\/[a-z0-9/-]*$/.test(input.path ?? "") ? input.path! : "/notifications",
    createdAt: new Date().toISOString(),
    read: false,
  };
  const saved = write(KEY, [item, ...decodeInbox(read(KEY)).items].slice(0, 100));
  if (decodePreferenceValue(read(PREFERENCES_KEY)).inApp) {
    toastManager.add({
      title: translate(readLocale(), item.title),
      description: translate(
        readLocale(),
        saved ? item.message : "Notification history could not be saved.",
      ),
      type: item.level,
    });
  }
  window.dispatchEvent(new CustomEvent<ShellNotification>(DELIVERY, { detail: item }));
  return saved;
}
export async function deliverDesktopNotification(
  item: Pick<ShellNotification, "id" | "title" | "message" | "path">,
) {
  const locale = readLocale();
  const localized = {
    ...item,
    title: translate(locale, item.title),
    message: translate(locale, item.message),
  };
  if (window.desktopBridge?.showNotification) {
    const result = await window.desktopBridge
      .showNotification(localized)
      .catch(() => ({ status: "failed", message: "Desktop notification delivery failed." }));
    const error =
      result.status === "failed" || result.status === "unsupported"
        ? (result.message ?? "Desktop notifications are unavailable.")
        : "";
    updateNotification(item.id, { desktopError: error });
    return;
  }
  if (!("Notification" in window) || Notification.permission !== "granted") {
    updateNotification(item.id, {
      desktopError:
        "Desktop notification permission is not granted. Enable notifications in Settings.",
    });
    return;
  }
  if (document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const notification = new Notification(localized.title, {
      body: localized.message,
      tag: item.id,
    });
    notification.addEventListener("click", () => {
      window.focus();
      window.location.hash = item.path;
      notification.close();
    });
    notification.addEventListener("error", () =>
      updateNotification(item.id, {
        desktopError: "The operating system could not display this notification.",
      }),
    );
    updateNotification(item.id, { desktopError: "" });
  } catch {
    updateNotification(item.id, { desktopError: "Desktop notification delivery failed." });
  }
}
export function subscribeNotificationDelivery(listener: (item: ShellNotification) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<ShellNotification>).detail);
  window.addEventListener(DELIVERY, handle);
  return () => window.removeEventListener(DELIVERY, handle);
}
export function desktopNotificationsEnabled() {
  return decodePreferenceValue(read(PREFERENCES_KEY)).desktop;
}
