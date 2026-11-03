import { useState } from "react";
import { saveLocale, useLocale } from "../useLocale";
import { Button } from "./ui/button";

export function LanguageSettings() {
  const { locale, t } = useLocale();
  const [failed, setFailed] = useState(false);
  return (
    <section className="space-y-3" aria-labelledby="setting-language">
      <h3 id="setting-language" tabIndex={-1} className="font-medium">
        {t("Language")}
      </h3>
      <p className="text-sm text-muted-foreground">
        {t("Choose the language used throughout Madar.")}
      </p>
      <div role="group" aria-label={t("Language")} className="flex flex-wrap gap-2">
        {(
          [
            ["en", "English"],
            ["ar", "العربية"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            lang={value}
            dir={value === "ar" ? "rtl" : "ltr"}
            variant={locale === value ? "default" : "outline"}
            aria-pressed={locale === value}
            onClick={() => setFailed(!saveLocale(value))}
          >
            {label}
          </Button>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Could not save language. Your previous language is still active.")}
        </p>
      ) : null}
    </section>
  );
}
