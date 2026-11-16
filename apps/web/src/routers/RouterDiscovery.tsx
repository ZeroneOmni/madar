import type { DiscoveredRouter } from "@madar/contracts";
import { Check, Network, Router } from "lucide-react";
import { useLocale } from "../useLocale";
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
  return (
    <section
      className="space-y-4 border-b pb-6"
      aria-label={t("Discover routers")}
      aria-busy={searching}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-3 text-primary">
            <Network size={24} aria-hidden="true" />
          </div>
          <h2 className="min-w-0 text-lg font-semibold">{t("Find your router")}</h2>
        </div>
        <svg
          role="img"
          aria-label={t("Automatic discovery, once a minute")}
          viewBox="0 0 36 36"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-9 shrink-0 text-muted-foreground"
        >
          <path d="M5 17a13 13 0 0 1 22-8.4L31 12m0-6v6h-6" className="text-primary" />
          <path d="M31 19a13 13 0 0 1-22 8.4L5 24m0 6v-6h6" className="text-primary" />
          <path d="M18 9v1m9 8h-1m-8 9v-1m-9-8h1" />
          <path d="M18 13v5l4 2.5" />
          <circle cx="18" cy="18" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      </div>
      {((searching && !result) || (result?.kind === "complete" && !routers.length)) && (
        <p role="status" className="rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {searching
            ? t("Listening for router advertisements…")
            : result?.kind === "complete" && !routers.length
              ? t("No routers found yet.")
              : ""}
        </p>
      )}
      {error && <p role="alert">{t(errors[error ?? "app"])}</p>}
      {routers.length > 0 && (
        <>
          <ul className="max-h-72 divide-y overflow-auto rounded-xl border">
            {routers.map((router) => (
              <li key={`${router.mac}/${router.host}`}>
                <button
                  type="button"
                  aria-pressed={!!router.host && selectedHost === router.host}
                  onClick={() => onSelect(router)}
                  className="group flex w-full cursor-pointer items-center gap-4 px-4 py-4 text-start outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring aria-pressed:bg-primary/8"
                >
                  <Router
                    size={22}
                    aria-hidden="true"
                    className="shrink-0 text-muted-foreground group-aria-pressed:text-primary"
                  />
                  <span className="min-w-0 flex-1 space-y-1">
                    <span className="block truncate font-semibold">
                      {router.identity || router.host || router.mac.toUpperCase()}
                    </span>
                    <span className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      {router.host && <span dir="ltr">{router.host}</span>}
                      {router.board && <span>{router.board}</span>}
                      {router.version && <span dir="ltr">RouterOS {router.version}</span>}
                      <span className="whitespace-nowrap" dir="ltr">
                        {router.mac.toUpperCase()}
                      </span>
                    </span>
                  </span>
                  {!router.host ? (
                    <span className="shrink-0 text-sm text-muted-foreground">
                      {t("IP address needed")}
                    </span>
                  ) : selectedHost === router.host ? (
                    <Check size={18} aria-label={t("Selected")} className="shrink-0 text-primary" />
                  ) : (
                    <span className="shrink-0 text-sm text-muted-foreground">{t("Select")}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("Discovery does not verify API access. Connections currently support RouterOS 6.")}
          </p>
        </>
      )}
    </section>
  );
}
