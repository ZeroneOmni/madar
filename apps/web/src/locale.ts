import { arabic } from "./messages";

export type Locale = "en" | "ar";
export const LOCALE_KEY = "madar:language";

export function resolveLocale(saved: string | null, languages: readonly string[]): Locale {
  if (saved === "ar" || saved === "en") return saved;
  for (const language of languages) {
    const base = language.toLowerCase().split("-")[0];
    if (base === "ar" || base === "en") return base;
  }
  return "en";
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
