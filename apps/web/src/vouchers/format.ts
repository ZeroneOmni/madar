import { translate, type Locale } from "../locale";

const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const durationUnits = {
  w: "weeks",
  d: "days",
  h: "hours",
  m: "minutes",
  s: "seconds",
  ms: "milliseconds",
} as const;

export function formatVoucherValue(
  value: string | undefined,
  field: string,
  locale: Locale,
): string {
  if (!value) return "–";
  if (value === "never") return translate(locale, "Never");
  if (value === "unlimited") return translate(locale, "Unlimited");
  const number = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    numberingSystem: locale === "ar" ? "arab" : "latn",
  });
  if ((field === "download" || field === "upload") && /^\d+$/.test(value)) {
    let amount = Number(value);
    const units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit++;
    }
    return `${number.format(amount)} ${translate(locale, units[unit]!)}`;
  }
  if (field === "uptime" && /^(?:\d+(?:ms|[wdhms]))+$/.test(value)) {
    return [...value.matchAll(/(\d+)(ms|[wdhms])/g)]
      .map(
        (match) =>
          `${number.format(Number(match[1]))} ${translate(locale, durationUnits[match[2] as keyof typeof durationUnits])}`,
      )
      .join(" ");
  }
  if (["lastSeen", "started", "ended"].includes(field)) {
    const date = /^(\w{3})\/(\d{1,2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/.exec(value);
    const month = date ? months.indexOf(date[1]!.toLowerCase()) : -1;
    if (date && month >= 0) {
      const timestamp = Date.UTC(
        Number(date[3]),
        month,
        Number(date[2]),
        Number(date[4] ?? 0),
        Number(date[5] ?? 0),
        Number(date[6] ?? 0),
      );
      return new Intl.DateTimeFormat(locale, {
        numberingSystem: locale === "ar" ? "arab" : "latn",
        calendar: "gregory",
        timeZone: "UTC",
        year: "numeric",
        month: "short",
        day: "numeric",
        ...(date[4] ? ({ hour: "2-digit", minute: "2-digit", second: "2-digit" } as const) : {}),
      }).format(timestamp);
    }
  }
  return value;
}

const numberFormat = (locale: Locale, maximumFractionDigits = 2) =>
  new Intl.NumberFormat(locale, {
    maximumFractionDigits,
    numberingSystem: locale === "ar" ? "arab" : "latn",
  });

export function formatBytes(value: number | null, locale: Locale): string {
  if (value === null) return "–";
  const units = ["bytes", "KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit++;
  }
  return `${numberFormat(locale, amount >= 100 ? 0 : amount >= 10 ? 1 : 2).format(amount)} ${translate(locale, units[unit]!)}`;
}

/** Exact durations, like RouterOS prints them: "1 d 2 h 3 m". */
export function formatDuration(seconds: number | null, locale: Locale): string {
  if (seconds === null) return "–";
  const number = numberFormat(locale);
  const parts: string[] = [];
  let rest = seconds;
  for (const [size, unit] of [
    [604800, "weeks"],
    [86400, "days"],
    [3600, "hours"],
    [60, "minutes"],
    [1, "seconds"],
  ] as const) {
    if (rest >= size) {
      parts.push(`${number.format(Math.floor(rest / size))} ${translate(locale, unit)}`);
      rest %= size;
    }
  }
  return parts.join(" ") || `${number.format(0)} ${translate(locale, "seconds")}`;
}

/** The largest whole unit, for "ends in 3 days" style summaries. */
export function formatSpan(seconds: number, locale: Locale): string {
  const number = numberFormat(locale, 0);
  for (const [size, one, many] of [
    [86400, "{count} day", "{count} days"],
    [3600, "{count} hour", "{count} hours"],
    [60, "{count} minute", "{count} minutes"],
  ] as const) {
    if (seconds >= size) {
      const count = Math.floor(seconds / size);
      return translate(locale, count === 1 ? one : many, { count: number.format(count) });
    }
  }
  return translate(locale, "less than a minute");
}

/** Router-local wall-clock text, shown as written by the router and never shifted by the PC zone. */
export function formatRouterTime(value: string | null, locale: Locale): string {
  if (!value) return "–";
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const [year, month, day, hour, minute] = match.slice(1).map(Number);
  return new Intl.DateTimeFormat(locale, {
    numberingSystem: locale === "ar" ? "arab" : "latn",
    calendar: "gregory",
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Date.UTC(year!, month! - 1, day!, hour, minute));
}

export function formatCount(value: number | null, locale: Locale): string {
  return value === null ? "–" : numberFormat(locale, 2).format(value);
}
