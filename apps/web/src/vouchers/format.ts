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
