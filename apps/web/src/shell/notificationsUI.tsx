import { useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  clearNotifications,
  deliverDesktopNotification,
  desktopNotificationsEnabled,
  dismissNotification,
  notifyShell,
  saveNotificationPreferences,
  subscribeNotificationDelivery,
  updateNotification,
  useNotificationInbox,
  useNotificationPreferences,
} from "./notifications";

export function NotificationsCoordinator({ onNavigate }: { onNavigate: (path: string) => void }) {
  useEffect(
    () =>
      subscribeNotificationDelivery((item) => {
        if (desktopNotificationsEnabled()) void deliverDesktopNotification(item);
      }),
    [],
  );
  useEffect(
    () =>
      window.desktopBridge?.onNotificationActivate?.((path) => {
        onNavigate(path);
      }),
    [onNavigate],
  );
  useEffect(() => {
    const observed = new Set<string>();
    return window.desktopBridge?.onUpdateState((state) => {
      if (state.status !== "downloaded" && state.status !== "error") return;
      const key = `${state.status}:${state.availableVersion ?? ""}:${state.message ?? ""}`;
      if (observed.has(key)) return;
      observed.add(key);
      if (state.status === "downloaded")
        notifyShell({
          title: "Madar update ready",
          message: "An update is ready to install.",
          level: "info",
          path: "/settings/general",
        });
      if (state.status === "error")
        notifyShell({
          title: "Madar update failed",
          message: state.message ?? "The update could not complete.",
          level: "error",
          path: "/settings/general",
        });
    });
  }, []);
  return null;
}

export function NotificationSettings() {
  const preferences = useNotificationPreferences();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  function save(next: typeof preferences) {
    const saved = saveNotificationPreferences(next);
    setMessage(
      saved
        ? "Notification preferences saved."
        : "Could not save notification preferences. Try again.",
    );
    if (saved)
      notifyShell({
        title: "Notification preferences saved",
        level: "success",
        path: "/settings/notifications",
      });
  }
  async function enableDesktop() {
    setPending(true);
    const native = window.desktopBridge?.notificationsSupported;
    const allowed = native
      ? await native().catch(() => false)
      : "Notification" in window &&
        (Notification.permission === "granted" ||
          (await Notification.requestPermission().catch(() => "denied")) === "granted");
    setPending(false);
    if (allowed) save({ ...preferences, desktop: true });
    else
      setMessage(
        "Desktop notifications are unavailable or blocked. Allow Madar notifications in your operating system or browser settings, then try again.",
      );
  }
  return (
    <section className="space-y-5" aria-label="Notification preferences">
      <h2 className="text-lg font-semibold">Notifications</h2>
      <label className="flex items-center gap-3">
        <Checkbox
          checked={preferences.inApp}
          onCheckedChange={(checked) => save({ ...preferences, inApp: checked })}
        />
        Show in-app toasts
      </label>
      <p className="text-sm text-muted-foreground">
        Operation results stay in Notifications even when toasts are off. Desktop notifications
        appear while Madar is in the background.
      </p>
      <div className="flex gap-3">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            preferences.desktop ? save({ ...preferences, desktop: false }) : void enableDesktop()
          }
        >
          {pending
            ? "Checking notification permission…"
            : preferences.desktop
              ? "Disable desktop notifications"
              : "Enable desktop notifications"}
        </Button>
      </div>
      {window.desktopBridge?.showNotification ? (
        <p className="text-sm text-muted-foreground">
          Your operating system controls whether Madar can display notifications. Enabling this
          preference does not override its permission or Do Not Disturb settings.
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function NotificationCenter({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { items, error } = useNotificationInbox();
  const [writeError, setWriteError] = useState("");
  const preferences = useNotificationPreferences();
  function result(saved: boolean) {
    setWriteError(saved ? "" : "Could not update notification history. Try again.");
  }
  return (
    <section className="space-y-5" aria-label="Notification history">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <span className="text-sm text-muted-foreground">
          {items.filter((item) => !item.read).length} unread
        </span>
        <Button
          variant="outline"
          onClick={() => result(clearNotifications())}
          disabled={!error && items.length === 0}
        >
          Clear history
        </Button>
        <Button variant="ghost" onClick={() => onNavigate("/settings/notifications")}>
          Notification settings
        </Button>
      </div>
      {error || writeError ? (
        <p role="alert" className="text-sm text-destructive">
          {writeError || error}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-muted-foreground">
          No notifications yet. Results from settings changes and app updates appear here.
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{item.title}</h2>
                {item.read ? (
                  <span className="text-xs text-muted-foreground">Read</span>
                ) : (
                  <span className="text-xs">Unread</span>
                )}
              </div>
              {item.message ? (
                <p className="text-sm text-muted-foreground">{item.message}</p>
              ) : null}
              <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString()}
              </time>
              {item.desktopError ? (
                <p role="alert" className="text-sm text-destructive">
                  {item.desktopError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (updateNotification(item.id, { read: true })) onNavigate(item.path);
                    else result(false);
                  }}
                >
                  Open
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => result(updateNotification(item.id, { read: !item.read }))}
                >
                  {item.read ? "Mark unread" : "Mark read"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => result(dismissNotification(item.id))}
                >
                  Dismiss
                </Button>
                {item.desktopError && preferences.desktop ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void deliverDesktopNotification(item)}
                  >
                    Retry desktop delivery
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
