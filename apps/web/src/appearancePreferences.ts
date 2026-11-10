import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";
import {
  appearanceFontStack,
  DEFAULT_SANS_FONT_STACK,
  DEFAULT_CODE_FONT_STACK,
} from "./appearanceFonts";

export const APPEARANCE_STORAGE_KEY = "madar:appearance-preferences";
const CHANGE_EVENT = "madar:appearance-preferences-change";
const integer = (minimum: number, maximum: number) =>
  Schema.Int.check(Schema.isBetween({ minimum, maximum }));
const Preferences = Schema.Struct({
  fontFamilySans: Schema.String.check(Schema.isMaxLength(200)),
  fontFamilyMono: Schema.String.check(Schema.isMaxLength(200)),
  fontSizeInterface: integer(12, 20),
  fontSizeMono: integer(10, 18),
  appearanceContrast: integer(50, 200),
  glassOpacity: integer(40, 100),
  panelAnimationDurationMs: integer(0, 400),
});
export type AppearancePreferences = typeof Preferences.Type;
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  fontFamilySans: "",
  fontFamilyMono: "",
  fontSizeInterface: 16,
  fontSizeMono: 13,
  appearanceContrast: 100,
  glassOpacity: 80,
  panelAnimationDurationMs: 0,
};
const decode = Schema.decodeSync(Schema.fromJsonString(Preferences));
const encode = Schema.encodeSync(Schema.fromJsonString(Preferences));
export function decodeAppearance(serialized: string | null) {
  return serialized === null ? DEFAULT_APPEARANCE : decode(serialized);
}
function snapshot() {
  try {
    return window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return "unavailable";
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
export function saveAppearance(update: Partial<AppearancePreferences>, replace = false) {
  try {
    const current = replace ? DEFAULT_APPEARANCE : decodeAppearance(snapshot());
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, encode({ ...current, ...update }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}
export function useAppearancePreferences() {
  const serialized = useSyncExternalStore(subscribe, snapshot, () => null);
  try {
    return { settings: decodeAppearance(serialized), error: false };
  } catch {
    return { settings: DEFAULT_APPEARANCE, error: true };
  }
}
export function applyAppearancePreferences(
  root: {
    style: Pick<CSSStyleDeclaration, "setProperty" | "fontSize">;
    dataset: DOMStringMap;
  },
  settings: AppearancePreferences,
) {
  root.style.setProperty(
    "--font-sans",
    appearanceFontStack(settings.fontFamilySans, DEFAULT_SANS_FONT_STACK),
  );
  root.style.setProperty(
    "--font-mono",
    appearanceFontStack(settings.fontFamilyMono, DEFAULT_CODE_FONT_STACK),
  );
  root.style.fontSize = `${settings.fontSizeInterface}px`;
  root.style.setProperty("--font-size-mono", `${settings.fontSizeMono}px`);
  root.style.setProperty(
    "--appearance-contrast-base",
    `${Math.min(settings.appearanceContrast, 100)}%`,
  );
  root.style.setProperty(
    "--appearance-contrast-boost",
    `${Math.max(settings.appearanceContrast - 100, 0)}%`,
  );
  root.style.setProperty(
    "--appearance-contrast-border-boost",
    `${Math.max(settings.appearanceContrast - 100, 0) / 4}%`,
  );
  root.style.setProperty("--glass-opacity", `${settings.glassOpacity}%`);
  root.style.setProperty("--panel-animation-duration", `${settings.panelAnimationDurationMs}ms`);
  root.dataset.panelAnimations = String(settings.panelAnimationDurationMs > 0);
}
export function useDocumentAppearance() {
  const { settings } = useAppearancePreferences();
  useEffect(() => {
    applyAppearancePreferences(document.documentElement, settings);
  }, [settings]);
}
