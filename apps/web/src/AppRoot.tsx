import { useDocumentAppearance } from "./appearancePreferences";
import { useLocale } from "./useLocale";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { useDocumentLocale } from "./useLocale";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { WorkspacePageHeader } from "./components/WorkspacePageHeader";
import { Button } from "./components/ui/button";
import { SidebarProvider, SidebarInset, useSidebar } from "./components/ui/sidebar";
import { ToastProvider } from "./components/ui/toast";
import { isElectron } from "./env";
import { useTheme } from "./hooks/useTheme";
import { installDesktopPasteAsText } from "./lib/desktopPasteAsText";
import { CommandMenu, useShellCommands } from "./shell/commands";
import { ShortcutSettings } from "./shell/shortcuts";
import { SettingsPage } from "./shell/settings";
import { usePrivacySettings } from "./shell/settingsState";
import { WelcomePage } from "./shell/WelcomePage";
import { ShellSidebar } from "./shell/ShellSidebar";
import { WorkspaceChrome } from "./shell/WorkspaceChrome";
import { useNavigation } from "./shell/useNavigation";
import { destinations, routeLabel } from "./shell/navigation";
import { navigateShell, useShellPath } from "./shell/routes";
import { SensitiveText } from "./shell/SensitiveText";
import {
  NotificationCenter,
  NotificationSettings,
  NotificationsCoordinator,
} from "./shell/notificationsUI";

function Overview({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useLocale();
  const { maskSensitive } = usePrivacySettings();
  return (
    <section className="mx-auto max-w-4xl space-y-8 p-(--workspace-page-padding)">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("Your User Manager workspace")}
        </h1>
        <p className="text-muted-foreground">
          {t("Organize your work and configure Madar from one place.")}
        </p>
      </div>
      <div className="space-y-3 rounded-xl border p-5">
        <h2 className="font-semibold">{t("Router connection")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "No router is connected. User Manager operations are unavailable until a supported RouterOS version and connection method are chosen.",
          )}
        </p>
        <p className="text-sm">
          {t(
            "You can organize navigation, customize shortcuts, and set privacy and notification preferences now.",
          )}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {destinations
          .filter((item) => item.id !== "overview" && item.id !== "notifications")
          .map((item) => (
            <section key={item.id} className="space-y-3 rounded-xl border p-5">
              <h2 className="font-semibold">{t(item.label)}</h2>
              <p className="text-sm text-muted-foreground">{t(item.description)}</p>
              <Button variant="outline" onClick={() => onNavigate("/" + item.id)}>
                {t("Open {name}", { name: t(item.label).toLowerCase() })}
              </Button>
            </section>
          ))}
      </div>
      <section className="space-y-3 rounded-xl border p-5">
        <h2 className="font-semibold">{t("Local workspace")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "This address identifies the app you are using. Your privacy preference controls whether it is hidden.",
          )}
        </p>
        <SensitiveText
          value={window.location.origin}
          label={t("Local app address")}
          masked={maskSensitive}
        />
        <div>
          <Button variant="link" size="sm" onClick={() => onNavigate("/settings/privacy")}>
            {t("Privacy preferences")}
          </Button>
        </div>
      </section>
    </section>
  );
}

function DestinationPage({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useLocale();
  const destination = destinations.find((item) => "/" + item.id === path);
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-(--workspace-page-padding)">
      <h1 className="text-3xl font-semibold">
        {destination ? t(destination.label) : t("Page not found")}
      </h1>
      <div className="space-y-3 rounded-xl border p-6">
        <TriangleAlert aria-hidden="true" />
        <h2 className="font-medium">
          {destination ? t("User Manager is not connected") : t("This page is unavailable")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {destination
            ? t(
                "Madar has no RouterOS integration configured yet. Live {name} will appear here when a supported router connection is available.",
                { name: t(destination.label) },
              )
            : t(
                "The link may be out of date. Choose a destination in the sidebar or return to the overview.",
              )}
        </p>
        <Button variant="outline" onClick={() => onNavigate("/overview")}>
          {t("Return to overview")}
        </Button>
      </div>
    </section>
  );
}

function ShellContent({ navigation }: { navigation: ReturnType<typeof useNavigation> }) {
  const { t } = useLocale();
  const rawPath = useShellPath();
  const { settings } = usePrivacySettings();
  const path = rawPath === "/" ? (settings.onboardingComplete ? "/overview" : "/welcome") : rawPath;
  const { toggleSidebar, setOpenMobile, isMobile } = useSidebar();
  function navigate(path: string) {
    navigateShell(path);
    if (isMobile) setOpenMobile(false);
  }
  const commands = useShellCommands({ onNavigate: navigate, onToggleSidebar: toggleSidebar });
  useEffect(
    () =>
      window.desktopBridge?.onMenuAction((action) => {
        if (action === "open-settings") navigateShell("/settings/general");
      }),
    [],
  );
  const settingsPage = path.startsWith("/settings");
  return (
    <WorkspaceChrome>
      <ShellSidebar
        error={navigation.error}
        state={navigation.state}
        path={path}
        onNavigate={navigate}
        onCommand={() => commands.execute("palette")}
        onChange={navigation.dispatch}
      />
      <SidebarInset>
        <WorkspacePageHeader electron={isElectron}>
          <nav
            aria-label={t("Workspace breadcrumbs")}
            className="[-webkit-app-region:no-drag] flex min-w-0 items-center gap-2 text-sm"
          >
            <Button variant="link" size="sm" onClick={() => navigate("/overview")}>
              Madar
            </Button>
            <span aria-hidden="true">/</span>
            <span className="truncate" aria-current="page">
              {t(routeLabel(path))}
            </span>
          </nav>
        </WorkspacePageHeader>
        {navigation.error ? (
          <div className="flex flex-wrap items-center gap-3 border-b bg-destructive/5 px-5 py-3">
            <p role="alert" className="flex-1 text-sm text-destructive">
              {t(navigation.error)}
            </p>
            <Button variant="outline" size="sm" onClick={navigation.reset}>
              {t("Reset navigation")}
            </Button>
          </div>
        ) : null}
        {commands.error ? (
          <div className="flex items-center gap-3 border-b px-5 py-3">
            <p role="alert" className="flex-1 text-sm">
              {t(commands.error)}
            </p>
            <Button variant="outline" size="sm" onClick={() => navigate("/settings/shortcuts")}>
              {t("Review shortcuts")}
            </Button>
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {settingsPage ? (
            <SettingsPage
              path={path}
              onNavigate={navigate}
              shortcutSettings={<ShortcutSettings />}
              notificationSettings={<NotificationSettings />}
            />
          ) : path === "/welcome" ? (
            <WelcomePage onContinue={() => navigate("/overview")} />
          ) : path === "/overview" ? (
            <Overview onNavigate={navigate} />
          ) : path === "/notifications" ? (
            <NotificationCenter onNavigate={navigate} />
          ) : (
            <DestinationPage path={path} onNavigate={navigate} />
          )}
        </div>
      </SidebarInset>
      <CommandMenu {...commands} />
      <NotificationsCoordinator onNavigate={navigate} />
      <QuitHoldOverlay />
    </WorkspaceChrome>
  );
}

export function AppRoot() {
  const direction = useDocumentLocale();
  useTheme();
  useDocumentAppearance();
  const navigation = useNavigation();
  useEffect(() => installDesktopPasteAsText(window.desktopBridge), []);
  return (
    <DirectionProvider direction={direction}>
      <ToastProvider position={direction === "rtl" ? "top-left" : "top-right"}>
        <SidebarProvider
          className="h-dvh"
          open={navigation.state.open}
          onOpenChange={(open) => navigation.dispatch({ type: "open", open })}
        >
          <ShellContent navigation={navigation} />
        </SidebarProvider>
      </ToastProvider>
    </DirectionProvider>
  );
}
