import { useEffect } from "react";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { WorkspacePageHeader } from "./components/WorkspacePageHeader";
import { isElectron } from "./env";
import { useTheme } from "./hooks/useTheme";
import { installDesktopPasteAsText } from "./lib/desktopPasteAsText";

export function AppRoot() {
  useTheme();
  useEffect(() => installDesktopPasteAsText(window.desktopBridge, window), []);
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <QuitHoldOverlay />
    </main>
  );
}
