import type { DiscoveredRouter } from "@madar/contracts";
import { Check, Router } from "lucide-react";
import { useLocale } from "../useLocale";
import { IconTile } from "../components/WorkspacePage";
import { useRouterDiscovery } from "./discoveryState";

const errors = {
  busy: "Another search is running. Try again shortly.",
  unavailable:
    "Discovery could not use UDP port 5678. Check your firewall and other discovery apps, then retry.",
  "no-network": "No connected IPv4 network was found. Connect to your local network and retry.",
  app: "Could not search for routers. Check the app connection and retry.",
};

export function RouterDiscovery({
  onSelect,
  selectedHost,
  savedHosts,
}: {
  onSelect: (router: DiscoveredRouter) => void;
  selectedHost: string;
  savedHosts: readonly string[];
}) {
  const { t } = useLocale();
  const { result, searching, error } = useRouterDiscovery();
  const saved = new Set(savedHosts);
  const routers =
    result?.kind === "complete"
      ? result.routers.filter((router) => !router.host || !saved.has(router.host))
      : [];
  const waiting = (searching && !result) || (result?.kind === "complete" && !routers.length);
  return (
    <section
      className="space-y-3 px-3 py-4 sm:px-4"
      aria-label={t("Discover routers")}
      aria-busy={searching}
    >
      <div className="flex items-center gap-3">
        <svg
          role="img"
          aria-label={t("Automatic discovery, once a minute")}
          viewBox="0 0 36 36"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-8 shrink-0 text-muted-foreground"
        >
          <path d="M5 17a13 13 0 0 1 22-8.4L31 12m0-6v6h-6" className="text-primary" />
          <path d="M31 19a13 13 0 0 1-22 8.4L5 24m0 6v-6h6" className="text-primary" />
          <path d="M18 9v1m9 8h-1m-8 9v-1m-9-8h1" />
          <path d="M18 13v5l4 2.5" />
          <circle cx="18" cy="18" r="1.5" fill="currentColor" stroke="none" />
        </svg>
        <div className="min-w-0 flex-1 space-y-0.5">
          <h3 className="text-sm font-medium">{t("Find your router")}</h3>
          {waiting ? (
            <p role="status" className="text-xs text-muted-foreground">
              {searching ? t("Listening for router advertisements…") : t("No routers found yet.")}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("Discovery does not verify API access. Connections currently support RouterOS 6.")}
            </p>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(errors[error ?? "app"])}
        </p>
      )}
      {routers.length > 0 && (
        <ul className="max-h-72 divide-y divide-border/50 overflow-auto rounded-lg border border-border/60 bg-background/60">
          {routers.map((router) => {
            const selected = !!router.host && selectedHost === router.host;
            return (
              <li key={`${router.mac}/${router.host}`}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(router)}
                  className="group flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-start outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-pressed:bg-primary/6"
                >
                  <IconTile className="group-aria-pressed:border-primary/30 group-aria-pressed:bg-primary/10 group-aria-pressed:text-primary">
                    <Router />
                  </IconTile>
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="block truncate text-sm font-medium">
                      {router.identity || router.host || router.mac.toUpperCase()}
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {router.host && <span dir="ltr">{router.host}</span>}
                      {router.board && <span>{router.board}</span>}
                      {router.version && <span dir="ltr">RouterOS {router.version}</span>}
                      <span className="whitespace-nowrap" dir="ltr">
                        {router.mac.toUpperCase()}
                      </span>
                    </span>
                  </span>
                  {!router.host ? (
                    <span className="shrink-0 text-xs text-warning-foreground">
                      {t("IP address needed")}
                    </span>
                  ) : selected ? (
                    <Check aria-label={t("Selected")} className="size-4 shrink-0 text-primary" />
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                      {t("Select")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
