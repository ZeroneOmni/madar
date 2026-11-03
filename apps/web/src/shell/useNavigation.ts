import { useState, useSyncExternalStore } from "react";
import {
  changeNavigation,
  decodeNavigation,
  defaultNavigation,
  NAVIGATION_KEY,
  saveNavigation,
  type NavigationAction,
  type NavigationState,
} from "./navigation";
import { notifyShell } from "./notifications";

const CHANGE_EVENT = "madar:navigation-change";

function readSerialized() {
  try {
    return window.localStorage.getItem(NAVIGATION_KEY);
  } catch {
    return "!unavailable";
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === NAVIGATION_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}
function resolve(serialized: string | null) {
  try {
    return { state: decodeNavigation(serialized), error: null };
  } catch {
    return {
      state: defaultNavigation,
      error: "Saved navigation could not be loaded. Reset it or retry after storage is available.",
    };
  }
}

export function useNavigation() {
  const serialized = useSyncExternalStore(subscribe, readSerialized, () => null);
  const { state, error: readError } = resolve(serialized);
  const [writeError, setWriteError] = useState<string | null>(null);
  function save(next: NavigationState) {
    try {
      saveNavigation(window.localStorage, next);
    } catch {
      const message =
        "Could not save navigation. Your previous layout is still in use. Please try again.";
      setWriteError(message);
      notifyShell({ title: "Navigation was not saved", message, level: "error" });
      return false;
    }
    setWriteError(null);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    return true;
  }
  function dispatch(action: NavigationAction) {
    let current: NavigationState;
    try {
      current = decodeNavigation(readSerialized());
    } catch {
      setWriteError("Reset saved navigation before changing the layout.");
      return false;
    }
    return save(changeNavigation(current, action));
  }
  return { state, error: writeError ?? readError, dispatch, reset: () => save(defaultNavigation) };
}
