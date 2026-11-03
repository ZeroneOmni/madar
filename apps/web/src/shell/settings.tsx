import { useEffect, useState, type ReactNode } from "react";
import { DEFAULT_CLIENT_SETTINGS, type QuitConfirmationMode } from "@madar/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import { ThemeSettings } from "../components/settings/ThemeSettings";
import { useTheme } from "../hooks/useTheme";
import { notifyShell } from "./notifications";
import { SETTINGS_SECTIONS, resolveSettingsPath, searchSettings } from "./settingsSearch";
import { resetOnboarding, saveSettings, usePrivacySettings } from "./settingsState";

function DesktopQuitSettings() {
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
        error: "Could not load desktop settings.",
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
            error: "Could not load desktop settings.",
          }));
      },
    );
    return () => {
      active = false;
    };
  }, [bridge]);
  return (
    <section className="space-y-3" aria-busy={bridge ? state.pending : false}>
      <h3 id="setting-quit-confirmation" tabIndex={-1} className="font-medium">
        Quit confirmation
      </h3>
      {bridge ? (
        <>
          <p className="text-sm text-muted-foreground">
            Choose how the desktop quit shortcut behaves.
          </p>
          <div role="group" aria-label="Quit confirmation" className="flex flex-wrap gap-2">
            {(
              [
                ["direct", "Quit immediately"],
                ["hold", "Hold shortcut"],
                ["double-click", "Press twice"],
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
                      error: "Could not save desktop settings.",
                    }));
                    notifyShell({
                      title: "Could not save quit confirmation",
                      level: "error",
                      path: "/settings/general",
                    });
                  }
                }}
              >
                {label}
              </Button>
            ))}
          </div>
          {state.pending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Updating desktop settings...
            </p>
          ) : null}
          {state.error ? (
            <div className="flex items-center gap-3">
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Quit confirmation is available in the Madar desktop app.
        </p>
      )}
    </section>
  );
}

function PrivacySettings() {
  const { settings, maskSensitive, source, error } = usePrivacySettings();
  const [scope, setScope] = useState<"application" | "workspace">("workspace");
  const [failed, setFailed] = useState(false);
  function save(update: Parameters<typeof saveSettings>[0], replace = false) {
    setFailed(!saveSettings(update, replace));
  }
  return (
    <section className="space-y-5">
      <h3 id="setting-privacy" tabIndex={-1} className="font-medium">
        Mask sensitive text
      </h3>
      <p className="text-sm text-muted-foreground">
        Hide sensitive values until you choose to reveal them. Copy still uses the original value.
      </p>
      {error ? (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">
            Could not read saved preferences. Sensitive values remain hidden. Restore defaults to
            recover.
          </p>
          <Button variant="outline" onClick={() => save({}, true)}>
            Restore local preferences
          </Button>
        </div>
      ) : null}
      <div role="group" aria-label="Privacy scope" className="flex flex-wrap gap-2">
        <Button
          variant={scope === "application" ? "default" : "outline"}
          aria-pressed={scope === "application"}
          onClick={() => setScope("application")}
        >
          Application defaults
        </Button>
        <Button
          variant={scope === "workspace" ? "default" : "outline"}
          aria-pressed={scope === "workspace"}
          onClick={() => setScope("workspace")}
        >
          This workspace
        </Button>
      </div>
      <div className="space-y-4 rounded-xl border p-4">
        <div className="flex items-center justify-between gap-4">
          <label htmlFor="privacy-mask">Hide sensitive values by default</label>
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
            ? `Application default: ${settings.maskSensitive ? "Hidden" : "Visible"}. Built-in default: Hidden.`
            : `Effective value: ${maskSensitive ? "Hidden" : "Visible"}. Source: ${source}.`}
        </p>
        {scope === "workspace" ? (
          <>
            <p className="text-sm text-muted-foreground">
              Workspace preferences inherit application defaults until you override them.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={error || settings.workspaceMaskSensitive === null}
              onClick={() => save({ workspaceMaskSensitive: null })}
            >
              Use application default
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={error || settings.maskSensitive}
            onClick={() => save({ maskSensitive: true })}
          >
            Restore built-in default
          </Button>
        )}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Could not save preferences. Your previous settings are still active. Try again.
        </p>
      ) : null}
    </section>
  );
}

function AppearanceSettings() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const [failed, setFailed] = useState(false);
  return (
    <section className="space-y-4">
      <h3 id="setting-appearance" tabIndex={-1} className="font-medium">
        Appearance
      </h3>
      <p className="text-sm text-muted-foreground">
        Choose how Madar looks. Changes are saved automatically.
      </p>
      <div role="group" aria-label="Appearance" className="flex flex-wrap gap-2">
        {(
          [
            ["system", "System"],
            ["light", "Light"],
            ["dark", "Dark"],
          ] as const
        ).map(([mode, label]) => (
          <Button
            key={mode}
            variant={appearanceMode === mode ? "default" : "outline"}
            aria-pressed={appearanceMode === mode}
            onClick={() => {
              const saved = setAppearanceMode(mode);
              setFailed(!saved);
              notifyShell({
                title: saved ? "Appearance saved" : "Could not save appearance",
                level: saved ? "success" : "error",
                path: "/settings/appearance",
              });
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Could not save your appearance. Please try again.
        </p>
      ) : null}
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
  const [query, setQuery] = useState("");
  const [resetFailed, setResetFailed] = useState(false);
  const { section, target, invalidTarget } = resolveSettingsPath(path);
  const matches = searchSettings(query);
  useEffect(() => {
    if (target) document.getElementById(`setting-${target.id}`)?.focus();
  }, [target]);
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside
        className="space-y-4 border-b p-4 md:w-60 md:shrink-0 md:border-r md:border-b-0"
        aria-label="Settings navigation"
      >
        <Input
          type="search"
          aria-label="Search settings"
          placeholder="Search settings..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <nav
          aria-label={query.trim() ? "Settings search results" : "Settings sections"}
          className="flex flex-wrap gap-1 md:flex-col md:items-start"
        >
          {query.trim()
            ? matches.map((item) => (
                <div key={item.id}>
                  <Button
                    variant="ghost"
                    size="sm-multiline"
                    onClick={() => onNavigate(`/settings/${item.section}?focus=${item.id}`)}
                  >
                    {item.title}
                  </Button>
                </div>
              ))
            : SETTINGS_SECTIONS.map((item) => (
                <div key={item.id}>
                  <Button
                    variant={section?.id === item.id ? "secondary" : "ghost"}
                    size="sm"
                    aria-current={section?.id === item.id ? "page" : undefined}
                    onClick={() => onNavigate(`/settings/${item.id}`)}
                  >
                    {item.label}
                  </Button>
                </div>
              ))}
          {query.trim() && matches.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              No settings found. Try another search.
            </p>
          ) : null}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 overflow-y-auto scrollbar-gutter-both p-5 sm:p-8">
        <div className="mx-auto max-w-3xl space-y-7">
          <nav aria-label="Settings breadcrumbs" className="flex items-center gap-2 text-sm">
            <Button variant="link" size="sm" onClick={() => onNavigate("/")}>
              Workspace
            </Button>
            <span aria-hidden="true">/</span>
            <Button variant="link" size="sm" onClick={() => onNavigate("/settings/general")}>
              Settings
            </Button>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{section?.label ?? "Unavailable"}</span>
          </nav>
          <h2 className="text-2xl font-semibold">{section?.label ?? "Setting not found"}</h2>
          {invalidTarget ? (
            <p role="alert" className="text-sm text-destructive">
              This settings link points to an unavailable setting. Choose a section or search again.
            </p>
          ) : null}
          {!section ? (
            <div className="space-y-4">
              <p className="text-muted-foreground">This settings section is unavailable.</p>
              <Button variant="outline" onClick={() => onNavigate("/settings/general")}>
                Open General settings
              </Button>
            </div>
          ) : null}
          {section?.id === "general" ? (
            <>
              <section className="space-y-3">
                <h3 id="setting-welcome" tabIndex={-1} className="font-medium">
                  Welcome and onboarding
                </h3>
                <p className="text-sm text-muted-foreground">
                  Revisit the introduction or restart setup for this workspace.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => onNavigate("/welcome")}>
                    Show welcome
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
                    Restart setup
                  </Button>
                </div>
                {resetFailed ? (
                  <p role="alert" className="text-sm text-destructive">
                    Could not reset setup. Try again.
                  </p>
                ) : null}
              </section>
              <DesktopQuitSettings />
            </>
          ) : null}
          {section?.id === "appearance" ? <AppearanceSettings /> : null}
          {section?.id === "privacy" ? <PrivacySettings /> : null}
          {section?.id === "shortcuts" ? (
            <section>
              <h3 id="setting-shortcuts" tabIndex={-1} className="sr-only">
                Keyboard shortcuts
              </h3>
              {shortcutSettings}
            </section>
          ) : null}
          {section?.id === "notifications" ? (
            <section>
              <h3 id="setting-notifications" tabIndex={-1} className="sr-only">
                Notifications
              </h3>
              {notificationSettings}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
