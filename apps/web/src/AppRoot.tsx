import { SettingsIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { QuitHoldOverlay } from "./components/QuitHoldOverlay";
import { WorkspacePageHeader } from "./components/WorkspacePageHeader";
import { isElectron } from "./env";
import { useTheme } from "./hooks/useTheme";
import { installDesktopPasteAsText } from "./lib/desktopPasteAsText";
import { isMacPlatform } from "./lib/utils";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./components/ui/dialog";

export function AppRoot() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => installDesktopPasteAsText(window.desktopBridge, window), []);
  useEffect(() => {
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "open-settings") setSettingsOpen(true);
    });
    const openSettings = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", openSettings);
    return () => {
      unsubscribe?.();
      window.removeEventListener("keydown", openSettings);
    };
  }, []);
  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <WorkspacePageHeader electron={isElectron}>
        {isElectron && isMacPlatform(navigator.platform) ? null : (
          <span className="text-sm font-semibold">Madar</span>
        )}
        <div className="ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
            <SettingsIcon />
            Settings
          </Button>
        </div>
      </WorkspacePageHeader>
      <section className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <h1 className="text-4xl font-semibold tracking-tight">Hello world</h1>
        <p className="text-muted-foreground">Welcome to Madar.</p>
      </section>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Choose how Madar looks. Changes are saved automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-3">
              <h2 id="appearance-heading" className="text-sm font-medium">
                Appearance
              </h2>
              <div role="group" aria-labelledby="appearance-heading" className="flex gap-2">
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
                    onClick={() => setSaveFailed(!setAppearanceMode(mode))}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {saveFailed ? (
                <p role="alert" className="text-sm text-destructive">
                  Could not save your appearance. Please try again.
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <QuitHoldOverlay />
    </main>
  );
}
