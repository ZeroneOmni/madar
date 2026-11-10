import type { ReactNode } from "react";
import { Undo2Icon } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger, TooltipProvider } from "../ui/tooltip";
import { useLocale } from "../../useLocale";

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex min-h-7 items-start justify-between gap-4 px-3 sm:px-4">
        <h2 className="flex min-h-7 items-center text-sm font-normal text-foreground/70">
          {title}
        </h2>
      </div>
      <div className="relative overflow-visible rounded-xl border border-border/60 bg-card/40 text-foreground shadow-xs/5 [&>*+*]:border-t [&>*+*]:border-border/50 [&>[data-slot=settings-row]]:rounded-none">
        {children}
      </div>
    </section>
  );
}
export function SettingResetButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useLocale();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={t("Reset {name} to default", { name: label })}
              onClick={onClick}
            >
              <Undo2Icon className="size-3" />
            </Button>
          }
        />
        <TooltipPopup>{t("Reset to default")}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}
export function SettingsRow({
  id,
  title,
  description,
  resetAction,
  control,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  resetAction?: ReactNode;
  control: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      id={id}
      tabIndex={-1}
      data-slot="settings-row"
      className={`@container/settings-row rounded-xl px-3 sm:px-4 ${children ? "pt-3 pb-1" : "py-3"}`}
    >
      <div className="flex flex-col gap-3 @min-[32rem]/settings-row:grid @min-[32rem]/settings-row:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] @min-[32rem]/settings-row:items-center @min-[32rem]/settings-row:gap-8">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <h3 className="text-sm font-medium text-foreground">{title}</h3>
            <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center">
              {resetAction}
            </span>
          </div>
          {description ? (
            <p className="max-w-xl text-xs leading-normal text-muted-foreground/80">
              {description}
            </p>
          ) : null}
        </div>
        <div className="flex w-full min-w-0 shrink-0 items-center gap-2 @min-[32rem]/settings-row:w-auto @min-[32rem]/settings-row:justify-end">
          {control}
        </div>
      </div>
      {children}
    </div>
  );
}
