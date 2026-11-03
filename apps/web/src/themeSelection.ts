import { useSyncExternalStore } from "react";
import { getThemeDefinition, getThemeColorsForMode, type ThemeAppearance } from "./themePalette";

const KEY = "madar:theme-halves:v1";
const EVENT = "madar:theme-selection";
function read() {
  try {
    return localStorage.getItem(KEY) ?? "{}";
  } catch {
    return "{}";
  }
}
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, listener);
  };
}
function readSelection(raw = read()): Partial<Record<ThemeAppearance, string>> {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([mode, id]) => (mode === "light" || mode === "dark") && typeof id === "string",
      ),
    );
  } catch {
    return {};
  }
}
export function selectTheme(id: string, mode?: ThemeAppearance) {
  const next = readSelection();
  const theme = getThemeDefinition(id);
  for (const appearance of mode ? [mode] : (["light", "dark"] as const)) {
    if (!theme || getThemeColorsForMode(theme, appearance)) next[appearance] = id;
  }
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVENT));
}
export function useThemeSelection() {
  const raw = useSyncExternalStore(subscribe, read, () => "{}");
  return readSelection(raw);
}
