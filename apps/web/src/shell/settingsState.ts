import * as Schema from "effect/Schema";
import { useSyncExternalStore } from "react";
import { notifyShell } from "./notifications";

export const SETTINGS_STORAGE_KEY = "madar:shell-settings";
const CHANGE_EVENT = "madar:shell-settings-change";
const SettingsState = Schema.Struct({
  onboardingComplete: Schema.Boolean,
});
export type SettingsState = typeof SettingsState.Type;
export const DEFAULT_SETTINGS: SettingsState = {
  onboardingComplete: false,
};

const decode = Schema.decodeSync(Schema.fromJsonString(SettingsState));
const encode = Schema.encodeSync(Schema.fromJsonString(SettingsState));

export function decodeSettings(serialized: string | null): SettingsState {
  return serialized === null ? DEFAULT_SETTINGS : decode(serialized);
}

function snapshot() {
  try {
    return window.localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return "unavailable";
  }
}

function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readSettings() {
  try {
    return { settings: decodeSettings(snapshot()), error: false };
  } catch {
    return { settings: DEFAULT_SETTINGS, error: true };
  }
}

export function saveSettings(update: Partial<SettingsState>, replace = false): boolean {
  let saved = false;
  try {
    const current = replace ? DEFAULT_SETTINGS : decodeSettings(snapshot());
    const next = encode({ ...current, ...update });
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
    saved = true;
  } catch {
    saved = false;
  }
  const setup = update.onboardingComplete !== undefined;
  notifyShell({
    title: saved
      ? setup
        ? update.onboardingComplete
          ? "Setup complete"
          : "Setup reset"
        : replace
          ? "Preferences restored"
          : "Preferences saved"
      : "Could not save preferences",
    message: saved
      ? setup
        ? "Your setup preference has been saved."
        : "Your preferences have been saved."
      : "Previous preferences are still active. Check local storage access and try again.",
    level: saved ? "success" : "error",
    path: setup ? "/welcome" : "/settings/general",
  });
  return saved;
}
export function useShellSettings() {
  const serialized = useSyncExternalStore(subscribe, snapshot, () => null);
  let state;
  try {
    state = { settings: decodeSettings(serialized), error: false };
  } catch {
    state = { settings: DEFAULT_SETTINGS, error: true };
  }
  return { ...state, saveSettings };
}

export function readOnboardingComplete() {
  return readSettings().settings.onboardingComplete;
}

export function resetOnboarding() {
  return saveSettings({ onboardingComplete: false });
}
