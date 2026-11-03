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
  const [revealed, setRevealed] = useState(false);
  const [copyError, setCopyError] = useState("");
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: label,
    onCopy: () => setCopyError(""),
    onError: () => setCopyError(`Could not copy ${label.toLowerCase()}. Try again.`),
  });
  const hidden = sensitive && masked && !revealed;
  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 break-all text-sm" aria-label={hidden ? `${label} hidden` : label}>
          {hidden ? "••••••••" : value}
        </code>
        {sensitive && masked ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`${revealed ? "Hide" : "Reveal"} ${label.toLowerCase()}`}
            onClick={() => setRevealed(!revealed)}
          >
            {revealed ? "Hide" : "Reveal"}
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!value}
          onClick={() => copyToClipboard(value)}
        >
          {isCopied ? "Copied" : `Copy ${label.toLowerCase()}`}
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
