import { ChevronRight, Compass, Plus } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../components/ui/empty";
import {
  FieldRow,
  IconTile,
  PageFrame,
  PageHeader,
  PageSection,
  Panel,
} from "../components/WorkspacePage";
import { RouterStatusBadge, RouterTile, useRouters } from "../routers/RouterConnections";
import { useLocale } from "../useLocale";
import { CopyableText } from "./CopyableText";
import { destinations, plannedDestinations } from "./navigation";
import { destinationIcons } from "./ShellSidebar";

function RouterSummary({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useLocale();
  const model = useRouters();
  const active = model.catalog.routers.find((router) => router.id === model.catalog.selected);
  const connected = model.state.kind === "connected" ? model.state : null;
  if (!active)
    return (
      <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
        <RouterTile kind="disconnected" />
        <div className="min-w-0 flex-1 basis-56 space-y-0.5">
          <p className="text-sm font-semibold">{t("No router selected")}</p>
          <p className="text-sm text-muted-foreground">
            {t(
              "Connect to your router to browse customer vouchers, create batches, manage profiles and check usage.",
            )}
          </p>
        </div>
        <Button size="sm" onClick={() => onNavigate("/routers")}>
          <Plus />
          {t("Add a router")}
        </Button>
      </div>
    );
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
      <RouterTile kind={model.state.kind} />
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <p className="truncate text-sm font-semibold">
          <bdi>{active.name}</bdi>
        </p>
        <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
          <span dir="ltr">
            {active.host}:{active.port}
          </span>
          {connected ? <span dir="ltr">RouterOS {connected.version}</span> : null}
        </p>
      </div>
      <RouterStatusBadge kind={model.state.kind} />
      <Button
        variant={connected ? "default" : "outline"}
        size="sm"
        onClick={() => onNavigate(connected ? "/vouchers" : "/routers")}
      >
        {t(connected ? "Open vouchers" : "Manage connections")}
      </Button>
    </div>
  );
}

export function OverviewPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useLocale();
  return (
    <PageFrame>
      <PageHeader
        title={t("Your User Manager workspace")}
        description={t("Check your router and open the tools you use every day.")}
      />
      <PageSection title={t("Router")}>
        <Panel>
          <RouterSummary onNavigate={onNavigate} />
        </Panel>
      </PageSection>
      <PageSection title={t("Tools")}>
        <Panel>
          {destinations
            .filter((item) => item.id !== "overview")
            .map((item) => {
              const Icon = destinationIcons[item.id];
              const planned = plannedDestinations.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate("/" + item.id)}
                  className="group flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-start outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5"
                >
                  <IconTile className="group-hover:text-foreground">
                    <Icon />
                  </IconTile>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-foreground">
                      {t(item.label)}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t(item.description)}
                    </span>
                  </span>
                  {planned ? (
                    <Badge variant="outline" size="sm">
                      {t("Planned")}
                    </Badge>
                  ) : null}
                  <ChevronRight
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground/60 group-hover:text-foreground rtl:rotate-180"
                  />
                </button>
              );
            })}
        </Panel>
      </PageSection>
      <PageSection title={t("This device")}>
        <Panel>
          <FieldRow
            label={t("Local app address")}
            description={t("This address identifies the app you are using.")}
          >
            <CopyableText
              value={window.location.origin}
              label={t("Local app address")}
              showLabel={false}
            />
          </FieldRow>
        </Panel>
      </PageSection>
    </PageFrame>
  );
}

export function DestinationPage({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const { t } = useLocale();
  const destination = destinations.find((item) => "/" + item.id === path);
  const Icon = destination ? destinationIcons[destination.id] : Compass;
  return (
    <PageFrame>
      <PageHeader
        title={destination ? t(destination.label) : t("Page not found")}
        description={destination ? t(destination.description) : undefined}
      />
      <Panel>
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <Icon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle role="heading" aria-level={2}>
              {destination
                ? t("User Manager operations are not available yet")
                : t("This page is unavailable")}
            </EmptyTitle>
            <EmptyDescription>
              {destination
                ? t(
                    "{name} is planned for a later release. Voucher management and usage are available in Vouchers.",
                    { name: t(destination.label) },
                  )
                : t(
                    "The link may be out of date. Choose a destination in the sidebar or return to the overview.",
                  )}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={() => onNavigate("/overview")}>
                {t("Return to overview")}
              </Button>
              {destination ? (
                <Button onClick={() => onNavigate("/vouchers")}>{t("Open vouchers")}</Button>
              ) : null}
            </div>
          </EmptyContent>
        </Empty>
      </Panel>
    </PageFrame>
  );
}
