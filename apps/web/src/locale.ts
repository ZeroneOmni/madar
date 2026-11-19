import { arabic } from "./messages";

export type Locale = "en" | "ar";
export const LOCALE_KEY = "madar:language";

export function resolveLocale(saved: string | null): Locale {
  if (saved === "ar" || saved === "en") return saved;
  return "ar";
}

const numberingSystem = (locale: Locale) => (locale === "ar" ? "arab" : "latn");

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { numberingSystem: numberingSystem(locale) }).format(value);
}

export function formatDateTime(value: string, locale: Locale): string {
  return new Date(value).toLocaleString(locale, {
    numberingSystem: numberingSystem(locale),
    calendar: "gregory",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function translate(
  locale: Locale,
  message: string,
  values: Readonly<Record<string, string | number>> = {},
): string {
  const translated =
    locale === "ar" && Object.hasOwn(arabic, message)
      ? arabic[message as keyof typeof arabic]
      : message;
  return translated.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
    values[key] === undefined ? placeholder : String(values[key]),
  );
}
