import { useEffect, useSyncExternalStore } from "react";
import { useMediaQuery } from "./useMediaQuery";

type AppearanceMode = "system" | "light" | "dark";

const STORAGE_KEY = "madar:theme-appearance-mode";
const CHANGE_EVENT = "madar:appearance-change";

function readAppearanceMode(): AppearanceMode {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}

function setAppearanceMode(mode: AppearanceMode): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

export function useTheme() {
  const appearanceMode = useSyncExternalStore<AppearanceMode>(
    subscribe,
    readAppearanceMode,
    () => "system",
  );
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)");
  const dark = appearanceMode === "dark" || (appearanceMode === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    const background = dark ? "#0a0a0a" : "#ffffff";
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", background);
    }
    void window.desktopBridge?.setTheme(appearanceMode).catch((error: unknown) => {
      console.error("Could not sync the desktop appearance.", error);
    });
  }, [appearanceMode, dark]);

  return { appearanceMode, setAppearanceMode };
}
