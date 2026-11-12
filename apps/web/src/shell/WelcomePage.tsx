import { LanguageSettings } from "../components/LanguageSettings";
import { useLocale } from "../useLocale";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { saveSettings } from "./settingsState";

export function WelcomePage({ onContinue }: { onContinue: () => void }) {
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <section className="mx-auto flex max-w-2xl flex-col gap-6 p-(--workspace-page-padding)">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("Welcome to Madar")}</h1>
        <p className="text-muted-foreground">
          {t("Your desktop workspace for MikroTik User Manager.")}
        </p>
      </div>
      <LanguageSettings />
      <div className="space-y-3 rounded-xl border p-5">
        <h2 className="font-medium">{t("Make the workspace yours")}</h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Organize navigation, search commands, and customize your shortcuts. Settings includes appearance, privacy, and notifications.",
          )}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            "Save and select a RouterOS 6 router to check its API connection. User Manager operations are not available yet.",
          )}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        {t("You can reopen this introduction from Settings / General.")}
      </p>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Could not save setup completion. Check local storage access and try again.")}
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
          {failed ? t("Try again") : t("Open workspace")}
        </Button>
      </div>
    </section>
  );
}
