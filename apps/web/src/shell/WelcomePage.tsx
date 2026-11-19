import { LanguageSettings } from "../components/LanguageSettings";
import { useLocale } from "../useLocale";
import { useState } from "react";
import { Router, SlidersHorizontal } from "lucide-react";
import { Button } from "../components/ui/button";
import { IconTile, Notice, PageFrame, PageSection, Panel } from "../components/WorkspacePage";
import { saveSettings } from "./settingsState";

export function WelcomePage({ onContinue }: { onContinue: () => void }) {
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  const features = [
    {
      icon: Router,
      title: t("Router connection"),
      description: t(
        "Connect to your router to browse customer vouchers, create batches, manage profiles and check usage.",
      ),
    },
    {
      icon: SlidersHorizontal,
      title: t("Make the workspace yours"),
      description: t(
        "Organize navigation, search commands, and customize your shortcuts. Settings includes appearance and notifications.",
      ),
    },
  ];
  return (
    <PageFrame>
      <header className="flex flex-col items-center gap-3 pt-4 text-center sm:pt-8">
        <img src="/brand/madar-logo.svg" alt="" className="size-16" />
        <h1 className="text-3xl leading-tight font-semibold text-foreground">
          {t("Welcome to Madar")}
        </h1>
        <p className="max-w-md text-muted-foreground">
          {t("Your desktop workspace for MikroTik User Manager.")}
        </p>
      </header>
      <Panel>
        <div className="px-4 py-4 sm:px-5">
          <LanguageSettings />
        </div>
      </Panel>
      <PageSection title={t("What you can do")}>
        <Panel>
          {features.map(({ icon: Icon, title, description }) => (
            <div key={title} className="flex items-start gap-3 px-4 py-3.5 sm:px-5">
              <IconTile>
                <Icon />
              </IconTile>
              <div className="min-w-0 space-y-0.5">
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>
          ))}
        </Panel>
      </PageSection>
      {failed ? (
        <Notice tone="error" announce>
          {t("Could not save setup completion. Check local storage access and try again.")}
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-6">
        <p className="text-sm text-muted-foreground">
          {t("You can reopen this introduction from Settings / General.")}
        </p>
        <Button
          size="lg"
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
    </PageFrame>
  );
}
