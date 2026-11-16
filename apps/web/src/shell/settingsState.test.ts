import { expect, it, vi } from "vite-plus/test";
vi.mock("./notifications", () => ({ notifyShell: vi.fn() }));
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  decodeSettings,
  readOnboardingComplete,
  readSettings,
  resetOnboarding,
  saveSettings,
} from "./settingsState";
import { resolveSettingsPath, searchSettings } from "./settingsSearch";
import { translate } from "../locale";

function setup() {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { localStorage: storage, dispatchEvent });
  return { values, storage, dispatchEvent, [Symbol.dispose]: () => vi.unstubAllGlobals() };
}

it("discards legacy masking preferences while preserving onboarding", () => {
  using state = setup();
  state.values.set(
    SETTINGS_STORAGE_KEY,
    JSON.stringify({
      maskSensitive: true,
      workspaceMaskSensitive: true,
      onboardingComplete: true,
    }),
  );
  expect(readSettings().settings).toEqual({ onboardingComplete: true });
  expect(saveSettings({ onboardingComplete: false })).toBe(true);
  expect(JSON.parse(state.values.get(SETTINGS_STORAGE_KEY)!)).toEqual(DEFAULT_SETTINGS);
});

it("keeps persisted preferences on failed writes and can retry", () => {
  using state = setup();
  expect(saveSettings({ onboardingComplete: true })).toBe(true);
  using write = vi.spyOn(state.storage, "setItem").mockImplementationOnce(() => {
    throw new Error("denied");
  });
  expect(resetOnboarding()).toBe(false);
  expect(readOnboardingComplete()).toBe(true);
  expect(resetOnboarding()).toBe(true);
  expect(readOnboardingComplete()).toBe(false);
  expect(write).toHaveBeenCalledTimes(2);
});

it("handles corrupt onboarding state and supports explicit recovery", () => {
  using state = setup();
  state.values.set(SETTINGS_STORAGE_KEY, '{"onboardingComplete":"yes"}');
  expect(readSettings()).toEqual({ settings: DEFAULT_SETTINGS, error: true });
  expect(saveSettings({ onboardingComplete: true })).toBe(false);
  expect(state.values.get(SETTINGS_STORAGE_KEY)).toBe('{"onboardingComplete":"yes"}');
  expect(saveSettings({}, true)).toBe(true);
  expect(readSettings()).toEqual({ settings: DEFAULT_SETTINGS, error: false });
});

it("persists onboarding completion across reads and permits revisiting or reset", () => {
  using state = setup();
  expect(readOnboardingComplete()).toBe(false);
  expect(saveSettings({ onboardingComplete: true })).toBe(true);
  expect(decodeSettings(state.values.get(SETTINGS_STORAGE_KEY) ?? null).onboardingComplete).toBe(
    true,
  );
  expect(readOnboardingComplete()).toBe(true);
  expect(resetOnboarding()).toBe(true);
  expect(readOnboardingComplete()).toBe(false);
});

it("matches every search term and resolves section-specific links without accepting unknown targets", () => {
  expect(searchSettings("privacy")).toEqual([]);
  expect(searchSettings("no such setting")).toEqual([]);
  expect(resolveSettingsPath("/settings/general?focus=welcome")).toMatchObject({
    section: { id: "general" },
    target: { id: "welcome" },
    invalidTarget: false,
  });
  expect(resolveSettingsPath("/settings/appearance?focus=privacy").invalidTarget).toBe(true);
  expect(resolveSettingsPath("/settings/missing").section).toBeUndefined();
  expect(resolveSettingsPath("/settings").section?.id).toBe("general");
});

it.each([
  ["السمات", "appearance"],
  ["فاتح", "appearance"],
  ["إشعارات سطح المكتب", "notifications"],
])("finds settings by the Arabic concept %s", (query, id) => {
  expect(
    searchSettings(query, (message) => translate("ar", message)).map((item) => item.id),
  ).toContain(id);
});
