import { useLocale } from "../useLocale";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";

export function CopyableText({ value, label = "Value" }: { value: string; label?: string }) {
  const { t } = useLocale();
  const [copyError, setCopyError] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: label,
    onCopy: () => setCopyError(""),
    onError: () =>
      setCopyError(t("Could not copy {name}. Try again.", { name: t(label).toLowerCase() })),
  });
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{t(label)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code dir="ltr" className="min-w-0 break-all" aria-label={label}>
          {value}
        </code>
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
