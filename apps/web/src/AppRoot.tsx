import { useDocumentAppearance } from "./appearancePreferences";
import { VouchersPage } from "./vouchers/VouchersPage";
import { RouterConnections, RouterPicker, RouterProvider } from "./routers/RouterConnections";
import { useLocale } from "./useLocale";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { useDocumentLocale } from "./useLocale";
import { useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { WorkspacePageHeader } from "./components/WorkspacePageHeader";
import { Button } from "./components/ui/button";
import { SidebarProvider, SidebarInset, useSidebar } from "./components/ui/sidebar";
import { ToastProvider } from "./components/ui/toast";
import { isElectron } from "./env";
import { useTheme } from "./hooks/useTheme";
import { installDesktopPasteAsText } from "./lib/desktopPasteAsText";
import { cn } from "./lib/utils";
import { CommandMenu, useShellCommands } from "./shell/commands";
import { ShortcutSettings } from "./shell/shortcuts";
import { SettingsPage } from "./shell/settings";
import { useShellSettings } from "./shell/settingsState";
import { WelcomePage } from "./shell/WelcomePage";
import { ShellSidebar } from "./shell/ShellSidebar";
import { WorkspaceChrome } from "./shell/WorkspaceChrome";
import { useNavigation } from "./shell/useNavigation";
import { routeLabel } from "./shell/navigation";
import { navigateShell, useShellPath } from "./shell/routes";
import { DestinationPage, OverviewPage } from "./shell/WorkspacePages";
import {
  NotificationCenter,
  NotificationSettings,
  NotificationsCoordinator,
} from "./shell/notificationsUI";

function ShellContent({ navigation }: { navigation: ReturnType<typeof useNavigation> }) {
  const { t } = useLocale();
  const rawPath = useShellPath();
  const { settings } = useShellSettings();
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
            className="[-webkit-app-region:no-drag] flex min-w-0 items-center gap-1 text-sm"
          >
            <Button variant="ghost-muted" size="xs" onClick={() => navigate("/overview")}>
              {t("Madar")}
            </Button>
            <ChevronRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground/50 rtl:rotate-180"
            />
            <span className="truncate px-1 font-medium text-foreground" aria-current="page">
              {t(routeLabel(path))}
            </span>
          </nav>
          <RouterPicker />
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
        <div
          className={cn("min-h-0 flex-1 overflow-y-auto", !settingsPage && "scrollbar-gutter-both")}
        >
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
            <OverviewPage onNavigate={navigate} />
          ) : path === "/routers" ? (
            <RouterConnections />
          ) : path === "/vouchers" ? (
            <VouchersPage />
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
          <RouterProvider>
            <ShellContent navigation={navigation} />
          </RouterProvider>
        </SidebarProvider>
      </ToastProvider>
    </DirectionProvider>
  );
}
