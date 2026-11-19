import { useLocale } from "../useLocale";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "../components/ui/button";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { cn } from "../lib/utils";

// Scales the user's monospace size so credentials stay prominent without ignoring it.
const largeMono = { fontSize: "calc(var(--font-size-mono, 13px) * 1.5)" };

export function CopyableText({
  value,
  label = "Value",
  showLabel = true,
  size = "default",
}: {
  value: string;
  label?: string;
  showLabel?: boolean;
  size?: "default" | "large" | "block";
}) {
  const { t } = useLocale();
  const [copyError, setCopyError] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: label,
    onCopy: () => setCopyError(""),
    onError: () =>
      setCopyError(t("Could not copy {name}. Try again.", { name: t(label).toLowerCase() })),
  });
  const copy = (
    <Button
      variant="ghost-muted"
      size="icon-xs"
      disabled={!value}
      aria-label={isCopied ? t("Copied") : t("Copy {name}", { name: t(label).toLowerCase() })}
      onClick={() => copyToClipboard(value)}
    >
      {isCopied ? <Check /> : <Copy />}
    </Button>
  );
  return (
    <div className="min-w-0 space-y-1">
      {showLabel ? <span className="block text-xs text-muted-foreground">{t(label)}</span> : null}
      {size === "block" ? (
        <div dir="ltr" className="relative rounded-lg border border-border/60 bg-muted/60">
          <pre
            aria-label={label}
            className="max-h-48 overflow-auto p-3 pe-10 leading-relaxed break-all whitespace-pre-wrap text-foreground"
          >
            {value}
          </pre>
          <div className="absolute end-1.5 top-1.5">{copy}</div>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-1">
          <code
            dir="ltr"
            aria-label={label}
            className={cn(
              "min-w-0 break-all text-foreground",
              size === "large" && "leading-tight font-semibold",
            )}
            style={size === "large" ? largeMono : undefined}
          >
            {value || "–"}
          </code>
          {copy}
        </div>
      )}
      {copyError ? (
        <p role="alert" className="text-xs text-destructive">
          {copyError}
        </p>
      ) : null}
    </div>
  );
}
