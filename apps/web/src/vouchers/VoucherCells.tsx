import type { ReactNode } from "react";
import { VOUCHER_NEARLY_ENDED, type VoucherRemaining, type VoucherRow } from "@madar/contracts";
import { CircleHelp, Lock } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../components/ui/tooltip";
import { formatDateTime, formatNumber, type Locale } from "../locale";
import { useLocale } from "../useLocale";
import { cn } from "../lib/utils";
import type { ColumnKey } from "./columns";
import { formatBytes, formatCount, formatDuration, formatRouterTime, formatSpan } from "./format";
import { VoucherState } from "./VoucherForms";

type Translate = ReturnType<typeof useLocale>["t"];

const unknownReasons: Record<Exclude<VoucherRemaining["reason"], "">, string> = {
  catalog: "Refresh customers and profiles to read this profile's limits.",
  limits:
    "This profile has limits that apply only at certain times, or limits Madar could not read. Check the profile on the router.",
  counters: "The router's usage counters for this voucher could not be read.",
  baseline:
    "Madar did not see this profile start, and the router's counters include earlier profiles. Activate the profile from Madar to start counting.",
  activation:
    "Madar does not know when this profile was activated, so it cannot calculate the end.",
  "first-login": "Madar will look for the first login at the next refresh.",
  clock: "Madar could not read the router's clock, so it cannot calculate the end.",
};
const bases: Record<Exclude<VoucherRemaining["basis"], "">, string> = {
  activation: "Counted from when Madar activated this profile.",
  new: "Counted from zero. Madar first saw this voucher unused.",
  "profile-change":
    "Estimated. Madar noticed the new profile at a refresh and counts usage from then. Usage before that refresh is not included.",
  "counter-reset":
    "Estimated. The router's usage counters were reset, so Madar counts usage from zero.",
};
const estimated = (basis: VoucherRemaining["basis"]) =>
  basis === "profile-change" || basis === "counter-reset";

function Explained({ label, children }: { label: ReactNode; children: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            className="inline-flex items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          />
        }
      >
        {label}
        <span className="sr-only">. {children}</span>
      </TooltipTrigger>
      <TooltipPopup>{children}</TooltipPopup>
    </Tooltip>
  );
}

/** Remaining data or time; shows how sure Madar is, never as router truth. */
export function RemainingCell({ row }: { row: VoucherRow }) {
  const { t, locale } = useLocale();
  const remaining = row.remaining;
  const amount = remaining.amount ?? 0;
  const timed = remaining.kind === "validity" || remaining.kind === "uptime";
  const value = timed ? formatSpan(amount, locale) : formatBytes(amount, locale);
  const marker = estimated(remaining.basis) ? (
    <span aria-hidden="true" className="me-1 text-muted-foreground">
      ≈
    </span>
  ) : null;
  const source = remaining.basis ? t(bases[remaining.basis]) : "";
  switch (remaining.state) {
    case "none":
      return <span className="text-muted-foreground">–</span>;
    case "unlimited":
      return <span className="text-muted-foreground">{t("Unlimited")}</span>;
    case "unknown":
      return (
        <Explained
          label={
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              {t("Unknown")}
              <CircleHelp aria-hidden="true" className="size-3.5" />
            </span>
          }
        >
          {t(unknownReasons[remaining.reason || "baseline"])}
        </Explained>
      );
    case "used-up":
    case "expired":
      return (
        <Explained
          label={
            <span className="font-medium text-destructive-foreground">
              {marker}
              {t(remaining.state === "used-up" ? "Used up" : "Expired")}
            </span>
          }
        >
          {[
            remaining.endsAt
              ? t("Ended {time} router time.", { time: formatRouterTime(remaining.endsAt, locale) })
              : "",
            source,
          ]
            .filter(Boolean)
            .join(" ")}
        </Explained>
      );
    case "not-started":
      return (
        <Explained label={<span className="text-muted-foreground">{t("Not started")}</span>}>
          {t("Validity starts at the first login and lasts {duration}.", {
            duration: formatDuration(row.validity, locale),
          })}
        </Explained>
      );
    default: {
      const ratio = remaining.limit ? amount / remaining.limit : null;
      const low =
        remaining.state === "ends"
          ? amount <= VOUCHER_NEARLY_ENDED.seconds
          : ratio !== null && ratio <= VOUCHER_NEARLY_ENDED.ratio;
      const text =
        remaining.state === "ends"
          ? t("Ends in {duration}", { duration: value })
          : remaining.kind === "download"
            ? t("{amount} download left", { amount: value })
            : remaining.kind === "upload"
              ? t("{amount} upload left", { amount: value })
              : t("{amount} left", { amount: value });
      const detail = [
        remaining.endsAt
          ? t("Ends {time} router time.", { time: formatRouterTime(remaining.endsAt, locale) })
          : remaining.limit
            ? t("{amount} of {limit}.", {
                amount: timed ? formatDuration(amount, locale) : formatBytes(amount, locale),
                limit: timed
                  ? formatDuration(remaining.limit, locale)
                  : formatBytes(remaining.limit, locale),
              })
            : "",
        source,
      ]
        .filter(Boolean)
        .join(" ");
      return (
        <Explained
          label={
            <span className="flex min-w-28 flex-col gap-1">
              <span className={cn("tabular-nums", low && "font-medium text-warning-foreground")}>
                {marker}
                {text}
              </span>
              {ratio !== null && (
                <span
                  aria-hidden="true"
                  className="block h-1 w-full rounded-full bg-muted-foreground/15"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      low ? "bg-warning" : "bg-primary/70",
                      estimated(remaining.basis) && "opacity-60",
                    )}
                    style={{ inlineSize: `${Math.max(2, Math.round(ratio * 100))}%` }}
                  />
                </span>
              )}
            </span>
          }
        >
          {detail}
        </Explained>
      );
    }
  }
}

const ltr = (value: string) => (value ? <bdi dir="ltr">{value}</bdi> : "–");
const madarTime = (value: string, locale: Locale) => (value ? formatDateTime(value, locale) : "–");

/** Plain text for one cell, used by the CSV export. */
export function cellText(key: ColumnKey, row: VoucherRow, locale: Locale, t: Translate): string {
  switch (key) {
    case "username":
      return row.username;
    case "state":
      return t(row.disabled ? "Disabled" : (row.activeSessions ?? 0) > 0 ? "Online" : "Enabled");
    case "profile":
      return row.profile;
    case "remaining":
      return row.remaining.amount === null ? "" : String(row.remaining.amount);
    case "dataUsed":
      return row.download === null || row.upload === null ? "" : String(row.download + row.upload);
    case "uptime":
      return row.uptime === null ? "" : String(row.uptime);
    case "lastSeen":
      return row.lastSeen ?? "";
    case "download":
      return row.download === null ? "" : String(row.download);
    case "upload":
      return row.upload === null ? "" : String(row.upload);
    case "activeSessions":
      return row.activeSessions === null ? "" : String(row.activeSessions);
    case "created":
      return row.registrationDate ?? "";
    case "price":
      return row.price === null ? "" : String(row.price);
    case "quota":
      return row.quota.transfer === null ? "" : String(row.quota.transfer);
    case "sharedUsers":
      return row.sharedUsers === null ? "" : String(row.sharedUsers);
    case "macLock":
      return row.callerId;
    case "ipAddress":
      return row.ipAddress;
    case "ipv6Dns":
      return row.ipv6Dns;
    case "ipv6Prefix":
      return row.ipv6Prefix;
    case "wireless":
      return row.wirelessEncryption;
    case "flags":
      return `${row.active ? "A" : ""}${row.incomplete ? "I" : ""}`;
    case "firstName":
      return row.firstName;
    case "lastName":
      return row.lastName;
    case "phone":
      return row.phone;
    case "email":
      return row.email;
    case "location":
      return row.location;
    case "firstSeen":
      return row.firstSeenAt;
    case "changed":
      return row.changedAt;
    case "firstLogin":
      return row.firstLoginAt ?? "";
    case "batch":
      return row.batch?.createdAt ?? "";
  }
}

export function Cell({ column, row }: { column: ColumnKey; row: VoucherRow }) {
  const { t, locale } = useLocale();
  switch (column) {
    case "username":
      return null;
    case "state":
      return <VoucherState voucher={row} />;
    case "profile":
      return row.profile ? (
        <bdi>{row.profile}</bdi>
      ) : (
        <span className="text-muted-foreground">{t("No profile")}</span>
      );
    case "remaining":
      return <RemainingCell row={row} />;
    case "dataUsed":
      return formatBytes(
        row.download === null || row.upload === null ? null : row.download + row.upload,
        locale,
      );
    case "uptime":
      return formatDuration(row.uptime, locale);
    case "lastSeen":
      return row.lastSeen === "never" ? (
        <span className="text-muted-foreground">{t("Never")}</span>
      ) : (
        formatRouterTime(row.lastSeen, locale)
      );
    case "download":
      return formatBytes(row.download, locale);
    case "upload":
      return formatBytes(row.upload, locale);
    case "activeSessions":
      return formatCount(row.activeSessions, locale);
    case "created":
      return formatRouterTime(row.registrationDate, locale);
    case "price":
      return formatCount(row.price, locale);
    case "quota":
      return <QuotaText row={row} />;
    case "sharedUsers":
      return row.sharedUsers === "unlimited"
        ? t("Unlimited")
        : formatCount(row.sharedUsers, locale);
    case "macLock":
      return row.callerId ? (
        <span className="inline-flex items-center gap-1">
          {ltr(row.callerId)}
          {row.callerIdBind && (
            <Lock aria-label={t("Locked to the first device")} className="size-3.5 shrink-0" />
          )}
        </span>
      ) : row.callerIdBind ? (
        <span className="text-muted-foreground">{t("Locks to the first device")}</span>
      ) : (
        "–"
      );
    case "ipAddress":
      return ltr(row.ipAddress);
    case "ipv6Dns":
      return ltr(row.ipv6Dns);
    case "ipv6Prefix":
      return ltr(row.ipv6Prefix);
    case "wireless":
      return ltr(row.wirelessEncryption);
    case "flags":
      return row.active || row.incomplete ? (
        <span className="inline-flex gap-1">
          {row.active && (
            <Explained label={<bdi dir="ltr">A</bdi>}>
              {t("Router flag A (active). Its exact meaning is not confirmed for User Manager 6.")}
            </Explained>
          )}
          {row.incomplete && (
            <Explained label={<bdi dir="ltr">I</bdi>}>
              {t(
                "Router flag I (incomplete). Its exact meaning is not confirmed for User Manager 6.",
              )}
            </Explained>
          )}
        </span>
      ) : (
        "–"
      );
    case "firstName":
    case "lastName":
    case "location": {
      const value =
        column === "firstName"
          ? row.firstName
          : column === "lastName"
            ? row.lastName
            : row.location;
      return value ? <bdi>{value}</bdi> : "–";
    }
    case "phone":
      return ltr(row.phone);
    case "email":
      return ltr(row.email);
    case "firstSeen":
      return madarTime(row.firstSeenAt, locale);
    case "changed":
      return madarTime(row.changedAt, locale);
    case "firstLogin":
      return formatRouterTime(row.firstLoginAt, locale);
    case "batch":
      return row.batch ? (
        <Explained
          label={
            <span className="tabular-nums">{formatDateTime(row.batch.createdAt, locale)}</span>
          }
        >
          {[
            t("{created} of {requested} vouchers created.", {
              created: formatNumber(row.batch.created, locale),
              requested: formatNumber(row.batch.requested, locale),
            }),
            row.batch.profile ? t("Profile: {name}.", { name: row.batch.profile }) : "",
            row.batch.comment ? t("Comment: {text}.", { text: row.batch.comment }) : "",
          ]
            .filter(Boolean)
            .join(" ")}
        </Explained>
      ) : (
        "–"
      );
  }
}

function QuotaText({ row }: { row: VoucherRow }) {
  const { t, locale } = useLocale();
  const parts = [
    row.quota.transfer !== null ? formatBytes(row.quota.transfer, locale) : "",
    row.quota.download !== null
      ? t("{amount} download", { amount: formatBytes(row.quota.download, locale) })
      : "",
    row.quota.upload !== null
      ? t("{amount} upload", { amount: formatBytes(row.quota.upload, locale) })
      : "",
    row.quota.uptime !== null ? formatDuration(row.quota.uptime, locale) : "",
    row.validity ? t("valid {duration}", { duration: formatDuration(row.validity, locale) }) : "",
  ].filter(Boolean);
  if (!row.profile) return "–";
  return parts.length ? parts.join(locale === "ar" ? "، " : ", ") : t("Unlimited");
}
