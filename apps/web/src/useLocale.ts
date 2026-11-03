import { useLayoutEffect, useSyncExternalStore } from "react";
import { LOCALE_KEY, resolveLocale, translate, type Locale } from "./locale";

const CHANGE_EVENT = "madar:language-change";

export function readLocale() {
  let saved = null;
  try {
    saved = window.localStorage.getItem(LOCALE_KEY);
  } catch {}
  return resolveLocale(saved, navigator.languages);
}

function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === LOCALE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

export function saveLocale(locale: Locale) {
  try {
    window.localStorage.setItem(LOCALE_KEY, locale);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

const translators = {
  en: (message: string, values?: Readonly<Record<string, string | number>>) =>
    translate("en", message, values),
  ar: (message: string, values?: Readonly<Record<string, string | number>>) =>
    translate("ar", message, values),
};

export function useLocale() {
  const locale = useSyncExternalStore(subscribe, readLocale, () => "en" as const);
  return {
    locale,
    direction: locale === "ar" ? ("rtl" as const) : ("ltr" as const),
    t: translators[locale],
  };
}

export function useDocumentLocale() {
  const { locale, direction } = useLocale();
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = direction;
  }, [locale, direction]);
  return direction;
}
