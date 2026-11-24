import * as DateTime from "effect/DateTime";

// RouterOS v6 User Manager values, as printed by the API. Dates are router-local wall-clock
// times without a zone; they stay naive ("YYYY-MM-DD HH:MM:SS") and never pass through the PC zone.
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (value: number, width = 2) => String(value).padStart(width, "0");

export function parseBytes(text: string): number | null {
  const match = /^(\d+)\s*B?$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}

export function parseDuration(text: string): number | null {
  const value = text.trim();
  const units = /^(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(value);
  if (units && value)
    return (
      Number(units[1] ?? 0) * 604800 +
      Number(units[2] ?? 0) * 86400 +
      Number(units[3] ?? 0) * 3600 +
      Number(units[4] ?? 0) * 60 +
      Number(units[5] ?? 0)
    );
  const clock = /^(?:(\d+)w)?(?:(\d+)d)?(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  return clock
    ? Number(clock[1] ?? 0) * 604800 +
        Number(clock[2] ?? 0) * 86400 +
        Number(clock[3]) * 3600 +
        Number(clock[4]) * 60 +
        Number(clock[5])
    : null;
}

export function parseRouterDateTime(text: string): string | null {
  const match = /^([a-z]{3})\/(\d{1,2})\/(\d{4})(?: (\d{1,2}):(\d{2}):(\d{2}))?$/i.exec(
    text.trim(),
  );
  if (!match) return null;
  const month = months.indexOf(match[1]!.toLowerCase());
  const [day, year, hour, minute, second] = [2, 3, 4, 5, 6].map((index) =>
    Number(match[index] ?? 0),
  );
  if (month < 0 || day! < 1 || day! > 31 || hour! > 23 || minute! > 59 || second! > 59) return null;
  return `${pad(year!, 4)}-${pad(month + 1)}-${pad(day!)} ${pad(hour!)}:${pad(minute!)}:${pad(second!)}`;
}

export function formatRouterDateTime(naive: string): string {
  const [date = "", time = ""] = naive.split(" ");
  const [year, month, day] = date.split("-");
  return `${months[Number(month) - 1]}/${day}/${year} ${time}`;
}

/** Arithmetic on naive values treats them as UTC so no zone or DST rule applies. */
export const naiveToEpoch = (naive: string) => Date.parse(`${naive.replace(" ", "T")}Z`);
export const epochToNaive = (epoch: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(epoch)).slice(0, 19).replace("T", " ");

export function parseCount(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text) : null;
}

export function parseSharedUsers(text: string) {
  if (text.trim() === "unlimited") return { count: null, unlimited: true };
  return { count: parseCount(text), unlimited: false };
}

export function parsePrice(text: string): number | null {
  const value = text.trim();
  return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}

export const parseFlag = (text: string | undefined) => text === "true" || text === "yes";

const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const allWeekdays = 0b1111111;
export function parseWeekdays(text: string): number | null {
  if (!text.trim()) return allWeekdays;
  let mask = 0;
  for (const name of text.split(",")) {
    const day = weekdayNames.indexOf(name.trim().toLowerCase());
    if (day < 0) return null;
    mask |= 1 << day;
  }
  return mask;
}

/** Digit runs become length-prefixed numbers so `v-2` sorts before `v-10` under binary collation. */
export function naturalKey(text: string): string {
  return text.toLowerCase().replace(/\d+/g, (digits) => {
    const trimmed = digits.replace(/^0+(?=\d)/, "");
    return pad(trimmed.length, 3) + trimmed;
  });
}
