import { LanguageSettings } from "../components/LanguageSettings";
import { useLocale } from "../useLocale";
import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_CLIENT_SETTINGS, type QuitConfirmationMode } from "@madar/contracts";
import { Button } from "../components/ui/button";
import { Switch } from "../components/ui/switch";
import { ThemeSettings } from "../components/settings/ThemeSettings";
import { notifyShell } from "./notifications";
import { resolveSettingsPath } from "./settingsSearch";
import { resetOnboarding, saveSettings, usePrivacySettings } from "./settingsState";

function DesktopQuitSettings() {
  const { t } = useLocale();
  const [state, setState] = useState<{
    mode: QuitConfirmationMode;
    pending: boolean;
    error: string | null;
  }>({ mode: "hold", pending: true, error: null });
  const bridge = window.desktopBridge;
  async function load() {
    if (!bridge) return;
    setState((current) => ({ ...current, pending: true, error: null }));
    try {
      const settings = await bridge.getClientSettings();
      setState({
        mode: settings?.confirmQuit ?? DEFAULT_CLIENT_SETTINGS.confirmQuit,
        pending: false,
        error: null,
      });
    } catch {
      setState((current) => ({
        ...current,
        pending: false,
        error: t("Could not load desktop settings."),
      }));
    }
  }
  useEffect(() => {
    if (!bridge) return;
    let active = true;
    void bridge.getClientSettings().then(
      (settings) => {
        if (active)
          setState({
            mode: settings?.confirmQuit ?? DEFAULT_CLIENT_SETTINGS.confirmQuit,
            pending: false,
            error: null,
          });
      },
      () => {
        if (active)
          setState((current) => ({
            ...current,
            pending: false,
            error: t("Could not load desktop settings."),
          }));
      },
    );
    return () => {
      active = false;
    };
  }, [bridge, t]);
  return (
    <section className="space-y-3" aria-busy={bridge ? state.pending : false}>
      <h3 id="setting-quit-confirmation" tabIndex={-1} className="font-medium">
        {t("Quit confirmation")}
      </h3>
      {bridge ? (
        <>
          <p className="text-sm text-muted-foreground">
            {t("Choose how the desktop quit shortcut behaves.")}
          </p>
          <div role="group" aria-label={t("Quit confirmation")} className="flex flex-wrap gap-2">
            {(
              [
                ["direct", t("Quit immediately")],
                ["hold", t("Hold shortcut")],
                ["double-click", t("Press twice")],
              ] as const
            ).map(([mode, label]) => (
              <Button
                key={mode}
                variant={state.mode === mode ? "default" : "outline"}
                aria-pressed={state.mode === mode}
                disabled={state.pending || state.error !== null}
                onClick={async () => {
                  setState((current) => ({ ...current, pending: true, error: null }));
                  try {
                    const settings = await bridge.getClientSettings();
                    await bridge.setClientSettings({
                      ...(settings ?? DEFAULT_CLIENT_SETTINGS),
                      confirmQuit: mode,
                    });
                    setState({ mode, pending: false, error: null });
                    notifyShell({
                      title: "Quit confirmation saved",
                      level: "success",
                      path: "/settings/general",
                    });
                  } catch {
                    setState((current) => ({
                      ...current,
                      pending: false,
                      error: t("Could not save desktop settings."),
                    }));
                    notifyShell({
                      title: "Could not save quit confirmation",
                      level: "error",
                      path: "/settings/general",
                    });
                  }
                }}
              >
                {t(label)}
              </Button>
            ))}
          </div>
          {state.pending ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("Updating desktop settings...")}
            </p>
          ) : null}
          {state.error ? (
            <div className="flex items-center gap-3">
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                {t("Retry")}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("Quit confirmation is available in the Madar desktop app.")}
        </p>
      )}
    </section>
  );
}

function PrivacySettings() {
  const { t } = useLocale();
  const { settings, maskSensitive, source, error } = usePrivacySettings();
  const [scope, setScope] = useState<"application" | "workspace">("workspace");
  const [failed, setFailed] = useState(false);
  function save(update: Parameters<typeof saveSettings>[0], replace = false) {
    setFailed(!saveSettings(update, replace));
  }
  return (
    <section className="space-y-5">
      <h3 id="setting-privacy" tabIndex={-1} className="font-medium">
        {t("Mask sensitive text")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t(
          "Hide sensitive values until you choose to reveal them. Copy still uses the original value.",
        )}
      </p>
      {error ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            {t(
              "Could not read saved preferences. Sensitive values remain hidden. Restore defaults to recover.",
            )}
          </p>
          <Button variant="outline" onClick={() => save({}, true)}>
            {t("Restore local preferences")}
          </Button>
        </div>
      ) : null}
      <div role="group" aria-label={t("Privacy scope")} className="flex flex-wrap gap-2">
        <Button
          variant={scope === "application" ? "default" : "outline"}
          aria-pressed={scope === "application"}
          onClick={() => setScope("application")}
        >
          {t("Application defaults")}
        </Button>
        <Button
          variant={scope === "workspace" ? "default" : "outline"}
          aria-pressed={scope === "workspace"}
          onClick={() => setScope("workspace")}
        >
          {t("This workspace")}
        </Button>
      </div>
      <div className="space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="privacy-mask">{t("Hide sensitive values by default")}</label>
          <Switch
            id="privacy-mask"
            checked={scope === "application" ? settings.maskSensitive : maskSensitive}
            disabled={error}
            onCheckedChange={(checked) =>
              save(
                scope === "application"
                  ? { maskSensitive: checked }
                  : { workspaceMaskSensitive: checked },
              )
            }
          />
        </div>
        <p role="status" className="text-sm text-muted-foreground">
          {scope === "application"
            ? t("Application default: {value}. Built-in default: Hidden.", {
                value: settings.maskSensitive ? t("Hidden") : t("Visible"),
              })
            : t("Effective value: {value}. Source: {source}.", {
                value: maskSensitive ? t("Hidden") : t("Visible"),
                source: t(source),
              })}
        </p>
        {scope === "workspace" ? (
          <>
            <p className="text-sm text-muted-foreground">
              {t("Workspace preferences inherit application defaults until you override them.")}
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={error || settings.workspaceMaskSensitive === null}
              onClick={() => save({ workspaceMaskSensitive: null })}
            >
              {t("Use application default")}
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={error || settings.maskSensitive}
            onClick={() => save({ maskSensitive: true })}
          >
            {t("Restore built-in default")}
          </Button>
        )}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Could not save preferences. Your previous settings are still active. Try again.")}
        </p>
      ) : null}
    </section>
  );
}

function AppearanceSettings() {
  const { t } = useLocale();
  return (
    <section>
      <h3 id="setting-appearance" tabIndex={-1} className="sr-only">
        {t("Appearance")}
      </h3>
      <ThemeSettings />
    </section>
  );
}

export function SettingsPage({
  path,
  onNavigate,
  shortcutSettings,
  notificationSettings,
}: {
  path: string;
  onNavigate: (path: string) => void;
  shortcutSettings?: ReactNode;
  notificationSettings?: ReactNode;
}) {
  const { t } = useLocale();
  const [resetFailed, setResetFailed] = useState(false);
  const { section, target, invalidTarget } = resolveSettingsPath(path);
  useEffect(() => {
    if (target) document.getElementById(`setting-${target.id}`)?.focus();
  }, [target]);
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="min-w-0 flex-1 overflow-y-auto scrollbar-gutter-both p-5 sm:p-8">
        <div
          className={`mx-auto space-y-7 ${section?.id === "appearance" ? "max-w-5xl" : "max-w-3xl"}`}
        >
          <nav aria-label={t("Settings breadcrumbs")} className="flex items-center gap-2 text-sm">
            <Button variant="link" size="sm" onClick={() => onNavigate("/")}>
              {t("Workspace")}
            </Button>
            <span aria-hidden="true">/</span>
            <Button variant="link" size="sm" onClick={() => onNavigate("/settings/general")}>
              {t("Settings")}
            </Button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{section ? t(section.label) : t("Unavailable")}</span>
          </nav>
          <h2 className="text-2xl font-semibold">
            {section ? t(section.label) : t("Setting not found")}
          </h2>
          {invalidTarget ? (
            <p role="alert" className="text-sm text-destructive">
              {t(
                "This settings link points to an unavailable setting. Choose a section or search again.",
              )}
            </p>
          ) : null}
          {!section ? (
            <div className="space-y-4">
              <p className="text-muted-foreground">{t("This settings section is unavailable.")}</p>
              <Button variant="outline" onClick={() => onNavigate("/settings/general")}>
                {t("Open General settings")}
              </Button>
            </div>
          ) : null}
          {section?.id === "general" ? (
            <>
              <section className="space-y-3">
                <h3 id="setting-welcome" tabIndex={-1} className="font-medium">
                  {t("Welcome and onboarding")}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t("Revisit the introduction or restart setup for this workspace.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => onNavigate("/welcome")}>
                    {t("Show welcome")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      if (resetOnboarding()) {
                        setResetFailed(false);
                        onNavigate("/welcome");
                      } else setResetFailed(true);
                    }}
                  >
                    {t("Restart setup")}
                  </Button>
                </div>
                {resetFailed ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t("Could not reset setup. Try again.")}
                  </p>
                ) : null}
              </section>
              <LanguageSettings />
              <DesktopQuitSettings />
            </>
          ) : null}
          {section?.id === "appearance" ? <AppearanceSettings /> : null}
          {section?.id === "privacy" ? <PrivacySettings /> : null}
          {section?.id === "shortcuts" ? (
            <section>
              <h3 id="setting-shortcuts" tabIndex={-1} className="sr-only">
                {t("Keyboard shortcuts")}
              </h3>
              {shortcutSettings}
            </section>
          ) : null}
          {section?.id === "notifications" ? (
            <section>
              <h3 id="setting-notifications" tabIndex={-1} className="sr-only">
                {t("Notifications")}
              </h3>
              {notificationSettings}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
