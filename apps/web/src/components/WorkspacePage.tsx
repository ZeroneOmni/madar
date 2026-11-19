import { useId, type ComponentProps, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import { Alert, AlertAction, AlertDescription } from "./ui/alert";
import { Button } from "./ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "./ui/collapsible";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

export function PageFrame({ wide = false, children }: { wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("mx-auto w-full space-y-8 p-5 sm:p-8", wide ? "max-w-5xl" : "max-w-3xl")}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
      <div className="min-w-0 flex-1 basis-80 space-y-1.5">
        <h1 className="text-2xl leading-tight font-semibold text-foreground">{title}</h1>
        {description ? (
          <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
        ) : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function PageSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <h2
        id={id}
        className="flex min-h-7 items-center px-3 text-sm font-normal text-foreground/70 sm:px-4"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Grouped surface for workspace and Settings pages; direct children are separated by hairlines. */
export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-xl border border-border/60 bg-card/40 text-foreground shadow-xs/5 [&>*+*]:border-t [&>*+*]:border-border/50">
      {children}
    </div>
  );
}

export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/50 bg-muted/30 px-3 py-3 sm:px-4">
      {children}
    </div>
  );
}

/**
 * A labelled control row. `controlId` ties the label to its input; `anchor` is the
 * element id Settings search scrolls to.
 */
export function FieldRow({
  controlId,
  anchor,
  label,
  description,
  action,
  children,
  below,
}: {
  controlId?: string;
  anchor?: string;
  label: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div
      id={anchor}
      tabIndex={anchor ? -1 : undefined}
      className="@container/field px-3 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4"
    >
      <div className="flex flex-col gap-2 @min-[34rem]/field:grid @min-[34rem]/field:grid-cols-[minmax(0,1fr)_minmax(14rem,auto)] @min-[34rem]/field:items-center @min-[34rem]/field:gap-8">
        <div className="min-w-0 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            {controlId ? (
              <label htmlFor={controlId} className="text-sm font-medium text-foreground">
                {label}
              </label>
            ) : (
              <h3 className="text-sm font-medium text-foreground">{label}</h3>
            )}
            {action}
          </div>
          {description ? (
            <p
              id={controlId && `${controlId}-description`}
              className="max-w-md text-xs leading-normal text-muted-foreground/80"
            >
              {description}
            </p>
          ) : null}
        </div>
        <div className="min-w-0 @min-[34rem]/field:flex @min-[34rem]/field:justify-end">
          {children}
        </div>
      </div>
      {below}
    </div>
  );
}

export function Disclosure({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group my-2 flex min-h-7 items-center gap-1.5 rounded-md px-3 text-sm text-foreground/70 outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4">
        {title}
        {meta}
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 text-muted-foreground transition-transform group-data-panel-open:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>{children}</CollapsiblePanel>
    </Collapsible>
  );
}

const tileSizes = {
  sm: "size-7 [&_svg]:size-3.5",
  md: "size-8 [&_svg]:size-4",
  lg: "size-10 [&_svg]:size-5",
};

/** Icon in a small framed square. Tone classes in `className` override the neutral frame. */
export function IconTile({
  size = "md",
  className,
  children,
}: {
  size?: keyof typeof tileSizes;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background text-muted-foreground",
        tileSizes[size],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Label and value inside a `<dl>`. */
export function Detail({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words text-foreground tabular-nums">{children}</dd>
    </div>
  );
}

const dotTone = {
  success: "bg-success",
  // Hollow green: usable but idle, so filled green can mean "in use now".
  ready: "border-2 border-success",
  info: "bg-info",
  warning: "bg-warning",
  danger: "bg-destructive",
  muted: "bg-muted-foreground/40",
};
export type DotTone = keyof typeof dotTone;

export function StatusDot({ tone }: { tone: DotTone }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", dotTone[tone])}
    />
  );
}

export function StatusLabel({
  tone,
  className,
  children,
  ...props
}: { tone: DotTone } & ComponentProps<"span">) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}
      {...props}
    >
      <StatusDot tone={tone} />
      {children}
    </span>
  );
}

/**
 * Inline guidance built on Alert. Alert announces itself by default, so pass
 * `announce` only for failures that appear after an action.
 */
export function Notice({
  tone = "default",
  icon,
  action,
  announce = false,
  children,
}: {
  tone?: "default" | "info" | "success" | "warning" | "error";
  icon?: ReactNode;
  action?: ReactNode;
  announce?: boolean;
  children?: ReactNode;
}) {
  return (
    <Alert variant={tone} controlAlignment="first-line" role={announce ? "alert" : undefined}>
      {icon}
      {children ? <AlertDescription>{children}</AlertDescription> : null}
      {action ? <AlertAction>{action}</AlertAction> : null}
    </Alert>
  );
}

export function IconAction({
  label,
  size = "icon-sm",
  ...props
}: { label: string; size?: "icon-sm" | "icon-xs" | "icon-micro" } & Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "size"
>) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost-muted" size={size} aria-label={label} {...props} />}
      />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
