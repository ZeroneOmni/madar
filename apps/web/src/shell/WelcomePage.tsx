import { useState } from "react";
import { Button } from "../components/ui/button";
import { saveSettings } from "./settingsState";

export function WelcomePage({ onContinue }: { onContinue: () => void }) {
  const [failed, setFailed] = useState(false);
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-6 sm:p-10">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome to Madar</h1>
        <p className="text-muted-foreground">Your desktop workspace for MikroTik User Manager.</p>
      </div>
      <div className="space-y-3 rounded-xl border p-5">
        <h2 className="font-medium">Make the workspace yours</h2>
        <p className="text-sm text-muted-foreground">
          Organize navigation, search commands, and customize your shortcuts. Settings includes
          appearance, privacy, and notifications.
        </p>
        <p className="text-sm text-muted-foreground">
          RouterOS operations become available after a supported version and connection method are
          configured. This workspace does not connect to a router yet.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        You can reopen this introduction from Settings / General.
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Could not save setup completion. Check local storage access and try again.
        </p>
      ) : null}
      <div>
        <Button
          onClick={() => {
            if (saveSettings({ onboardingComplete: true })) {
              setFailed(false);
              onContinue();
            } else setFailed(true);
          }}
        >
          {failed ? "Try again" : "Open workspace"}
        </Button>
      </div>
    </section>
  );
}
