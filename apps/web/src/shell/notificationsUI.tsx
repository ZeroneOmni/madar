import { useLocale } from "../useLocale";
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
  const { t } = useLocale();
  const preferences = useNotificationPreferences();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  function save(next: typeof preferences) {
    const saved = saveNotificationPreferences(next);
    setMessage(
      saved
        ? t("Notification preferences saved.")
        : t("Could not save notification preferences. Try again."),
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
        t(
          "Desktop notifications are unavailable or blocked. Allow Madar notifications in your operating system or browser settings, then try again.",
        ),
      );
  }
  return (
    <section className="space-y-5" aria-label={t("Notification preferences")}>
      <h2 className="text-lg font-semibold">{t("Notifications")}</h2>
      <label className="flex items-center gap-3">
        <Checkbox
          checked={preferences.inApp}
          onCheckedChange={(checked) => save({ ...preferences, inApp: checked })}
        />
        {t("Show in-app toasts")}
      </label>
      <p className="text-sm text-muted-foreground">
        {t(
          "Operation results stay in Notifications even when toasts are off. Desktop notifications appear while Madar is in the background.",
        )}
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
            ? t("Checking notification permission…")
            : preferences.desktop
              ? t("Disable desktop notifications")
              : t("Enable desktop notifications")}
        </Button>
      </div>
      {window.desktopBridge?.showNotification ? (
        <p className="text-sm text-muted-foreground">
          {t(
            "Your operating system controls whether Madar can display notifications. Enabling this preference does not override its permission or Do Not Disturb settings.",
          )}
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
  const { t, locale } = useLocale();
  const { items, error } = useNotificationInbox();
  const [writeError, setWriteError] = useState("");
  const preferences = useNotificationPreferences();
  function result(saved: boolean) {
    setWriteError(saved ? "" : t("Could not update notification history. Try again."));
  }
  return (
    <section
      className="mx-auto max-w-3xl space-y-5 p-(--workspace-page-padding)"
      aria-label={t("Notification history")}
    >
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t("Notifications")}</h1>
        <span className="text-sm text-muted-foreground">
          {t("{count} unread", { count: items.filter((item) => !item.read).length })}
        </span>
        <Button
          variant="outline"
          onClick={() => result(clearNotifications())}
          disabled={!error && items.length === 0}
        >
          {t("Clear history")}
        </Button>
        <Button variant="ghost" onClick={() => onNavigate("/settings/notifications")}>
          {t("Notification settings")}
        </Button>
      </div>
      {error || writeError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(writeError || error || "")}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="text-muted-foreground">
          {t("No notifications yet. Results from settings changes and app updates appear here.")}
        </p>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-2 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-medium">{t(item.title)}</h2>
                {item.read ? (
                  <span className="text-xs text-muted-foreground">{t("Read")}</span>
                ) : (
                  <span className="text-xs">{t("Unread")}</span>
                )}
              </div>
              {item.message ? (
                <p className="text-sm text-muted-foreground">{t(item.message)}</p>
              ) : null}
              <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                {new Date(item.createdAt).toLocaleString(locale)}
              </time>
              {item.desktopError ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(item.desktopError)}
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
                  {t("Open")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => result(updateNotification(item.id, { read: !item.read }))}
                >
                  {item.read ? t("Mark unread") : t("Mark read")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => result(dismissNotification(item.id))}
                >
                  {t("Dismiss")}
                </Button>
                {item.desktopError && preferences.desktop ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void deliverDesktopNotification(item)}
                  >
                    {t("Retry desktop delivery")}
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
