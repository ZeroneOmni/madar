import { useLocale } from "../useLocale";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

export function SensitiveText({
  value,
  label = "Value",
  sensitive = true,
  masked = true,
}: {
  value: string;
  label?: string;
  sensitive?: boolean;
  masked?: boolean;
}) {
  const { t } = useLocale();
  const [revealed, setRevealed] = useState(false);
  const [copyError, setCopyError] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: label,
    onCopy: () => setCopyError(""),
    onError: () =>
      setCopyError(t("Could not copy {name}. Try again.", { name: t(label).toLowerCase() })),
  });
  const hidden = sensitive && masked && !revealed;
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{t(label)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code
          dir="ltr"
          className="min-w-0 break-all"
          aria-label={hidden ? t("{name} hidden", { name: t(label) }) : label}
        >
          {hidden ? "••••••••" : value}
        </code>
        {sensitive && masked ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={t(revealed ? "Hide {name}" : "Reveal {name}", {
              name: t(label).toLowerCase(),
            })}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? t("Hide") : t("Reveal")}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!value}
          onClick={() => copyToClipboard(value)}
        >
          {isCopied ? t("Copied") : t("Copy {name}", { name: t(label).toLowerCase() })}
        </Button>
      </div>
      {copyError ? (
        <p role="alert" className="text-sm text-destructive">
          {copyError}
        </p>
      ) : null}
    </div>
  );
}
