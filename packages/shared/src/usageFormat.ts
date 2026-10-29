// @effect-diagnostics globalDate:off -- Usage windows are calendar days in the viewer's zone, derived from wall-clock "now" via Intl.
import { UsageDay, type UsageResolution, type UsageSummaryInput } from "@t3tools/contracts";

const HOUR_MS = 60 * 60 * 1000;

const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function dateTimeFormatter(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  if (options.timeZone === undefined) return new Intl.DateTimeFormat(locale, options);
  const key = JSON.stringify([locale, options]);
  let formatter = dateTimeFormatters.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, options);
    if (dateTimeFormatters.size >= 16) dateTimeFormatters.clear();
    dateTimeFormatters.set(key, formatter);
  }
  return formatter;
}

function hourOptions(hour12: boolean): Intl.DateTimeFormatOptions {
  return hour12 ? { hour: "numeric" } : { hour: "2-digit", hourCycle: "h23" };
}

function formatHour(formatter: Intl.DateTimeFormat, date: Date, hour12: boolean): string {
  if (hour12) return formatter.format(date);
  // Rolling buckets can start between whole hours, but their labels always name the hour.
  return formatter
    .formatToParts(date)
    .map((part) => (part.type === "hour" ? `${part.value}:00` : part.value))
    .join("");
}

/**
 * Repeated wall-clock hours during a fall-back transition include their short zone name so the
 * two distinct buckets remain distinguishable.
 */
export function formatHourShort(hourStart: string, timeZone?: string, hour12 = true): string {
  const instant = new Date(hourStart);
  if (Number.isNaN(instant.getTime())) return hourStart;
  const options = timeZone === undefined ? {} : { timeZone };
  const hourFormat = dateTimeFormatter("en-US", {
    ...options,
    ...hourOptions(hour12),
  });
  const wallHourFormat = dateTimeFormatter("en-CA", {
    ...options,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  });
  const wallHour = wallHourFormat.format(instant);
  const isRepeatedHour = [-HOUR_MS, HOUR_MS].some(
    (offset) => wallHourFormat.format(new Date(instant.getTime() + offset)) === wallHour,
  );

  if (!isRepeatedHour) return formatHour(hourFormat, instant, hour12);
  const zonedHourFormat = dateTimeFormatter("en-US", {
    ...options,
    ...hourOptions(hour12),
    timeZoneName: "short",
  });
  return formatHour(zonedHourFormat, instant, hour12);
}

export function makeWindow(
  days: number,
  now = new Date(),
  resolution: UsageResolution = "day",
): UsageSummaryInput {
  let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    timeZone = "UTC";
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  const untilDay = format.format(now);
  if (resolution === "hour") {
    const untilTimeMs = Math.floor(now.getTime() / 60_000) * 60_000;
    const sinceTimeMs = untilTimeMs - 24 * HOUR_MS;
    const sinceTime = new Date(sinceTimeMs);
    const untilTime = new Date(untilTimeMs);
    return {
      sinceDay: UsageDay.make(format.format(sinceTime)),
      untilDay: UsageDay.make(format.format(untilTime)),
      timeZone,
      resolution,
      sinceTime: sinceTime.toISOString(),
      untilTime: untilTime.toISOString(),
    };
  }
  // Use calendar arithmetic in UTC; fixed millisecond subtraction crosses DST days incorrectly.
  const [year = 0, month = 1, dayOfMonth = 1] = untilDay
    .split("-")
    .map((part) => Number.parseInt(part, 10));
  const start = new Date(Date.UTC(year, month - 1, dayOfMonth - (days - 1)));
  return {
    sinceDay: UsageDay.make(start.toISOString().slice(0, 10)),
    untilDay: UsageDay.make(untilDay),
    timeZone,
    resolution,
  };
}
