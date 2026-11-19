import { useLocale } from "../useLocale";
import { formatDateTime, formatNumber } from "../locale";
import { useEffect, useState } from "react";
import { Bell, CircleAlert, CircleCheck, Info, Settings2 } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import { IconTile, Notice, PageFrame, PageHeader, Panel } from "../components/WorkspacePage";
import { cn } from "../lib/utils";
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
          message: "The update could not complete.",
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

const levelIcons = { success: CircleCheck, error: CircleAlert, info: Info };
const levelTones = {
  success: "text-success-foreground",
  error: "text-destructive-foreground",
  info: "text-muted-foreground",
};

export function NotificationCenter({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t, locale } = useLocale();
  const { items, error } = useNotificationInbox();
  const [writeError, setWriteError] = useState("");
  const preferences = useNotificationPreferences();
  const unread = items.filter((item) => !item.read).length;
  function result(saved: boolean) {
    setWriteError(saved ? "" : t("Could not update notification history. Try again."));
  }
  return (
    <PageFrame>
      <PageHeader
        title={t("Notifications")}
        description={t("{count} unread", { count: formatNumber(unread, locale) })}
        actions={
          <>
            <Button variant="ghost" onClick={() => onNavigate("/settings/notifications")}>
              <Settings2 />
              {t("Notification settings")}
            </Button>
            <Button
              variant="outline"
              onClick={() => result(clearNotifications())}
              disabled={!error && items.length === 0}
            >
              {t("Clear history")}
            </Button>
          </>
        }
      />
      {error || writeError ? (
        <Notice tone="error" icon={<CircleAlert />} announce>
          {t(writeError || error || "")}
        </Notice>
      ) : null}
      <section aria-label={t("Notification history")}>
        {items.length === 0 ? (
          <Panel>
            <Empty size="compact">
              <EmptyMedia variant="icon">
                <Bell />
              </EmptyMedia>
              <EmptyHeader>
                <EmptyTitle>{t("No notifications yet.")}</EmptyTitle>
                <EmptyDescription>
                  {t("Results from settings changes and app updates appear here.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Panel>
        ) : (
          <Panel>
            <ul className="divide-y divide-border/50">
              {items.map((item) => {
                const Icon = levelIcons[item.level];
                return (
                  <li
                    key={item.id}
                    className={cn("flex gap-3 px-4 py-3.5 sm:px-5", !item.read && "bg-primary/3")}
                  >
                    <IconTile size="sm" className={cn("mt-0.5", levelTones[item.level])}>
                      <Icon />
                      {!item.read ? (
                        <span className="absolute -end-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-background" />
                      ) : null}
                    </IconTile>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <h2
                          className={cn(
                            "text-sm",
                            item.read ? "text-foreground/80" : "font-semibold text-foreground",
                          )}
                        >
                          {t(item.title)}
                        </h2>
                        <span className="sr-only">{item.read ? t("Read") : t("Unread")}</span>
                        <time
                          className="shrink-0 text-xs text-muted-foreground tabular-nums"
                          dateTime={item.createdAt}
                        >
                          {formatDateTime(item.createdAt, locale)}
                        </time>
                      </div>
                      {item.message ? (
                        <p className="text-sm text-muted-foreground">{t(item.message)}</p>
                      ) : null}
                      {item.desktopError ? (
                        <p role="alert" className="text-sm text-destructive">
                          {t(item.desktopError)}
                        </p>
                      ) : null}
                      <div className="-ms-2 flex flex-wrap gap-1 pt-1">
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={() => {
                            if (updateNotification(item.id, { read: true })) onNavigate(item.path);
                            else result(false);
                          }}
                        >
                          {t("Open")}
                        </Button>
                        <Button
                          variant="ghost-muted"
                          size="xs"
                          onClick={() => result(updateNotification(item.id, { read: !item.read }))}
                        >
                          {item.read ? t("Mark unread") : t("Mark read")}
                        </Button>
                        <Button
                          variant="ghost-muted"
                          size="xs"
                          onClick={() => result(dismissNotification(item.id))}
                        >
                          {t("Dismiss")}
                        </Button>
                        {item.desktopError && preferences.desktop ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => void deliverDesktopNotification(item)}
                          >
                            {t("Retry desktop delivery")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Panel>
        )}
      </section>
    </PageFrame>
  );
}
