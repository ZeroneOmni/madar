import { expect, it, vi } from "vite-plus/test";
vi.mock("./notifications", () => ({ notifyShell: vi.fn() }));
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  decodeSettings,
  effectivePrivacy,
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

it("persists workspace overrides, inherits later application changes after reset, and restores defaults", () => {
  using state = setup();
  expect(effectivePrivacy(decodeSettings(null))).toEqual({
    maskSensitive: true,
    source: "Application default",
  });
  expect(saveSettings({ maskSensitive: false })).toBe(true);
  expect(effectivePrivacy(readSettings().settings).maskSensitive).toBe(false);
  expect(saveSettings({ workspaceMaskSensitive: true })).toBe(true);
  expect(effectivePrivacy(readSettings().settings)).toEqual({
    maskSensitive: true,
    source: "Workspace override",
  });
  expect(saveSettings({ workspaceMaskSensitive: null })).toBe(true);
  expect(effectivePrivacy(readSettings().settings)).toEqual({
    maskSensitive: false,
    source: "Application default",
  });
  expect(saveSettings({ maskSensitive: true })).toBe(true);
  expect(readSettings().settings).toEqual(DEFAULT_SETTINGS);
  expect(state.dispatchEvent).toHaveBeenCalled();
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

it("protects sensitive values when saved state is corrupt and supports explicit recovery", () => {
  using state = setup();
  state.values.set(SETTINGS_STORAGE_KEY, '{"maskSensitive":"yes"}');
  expect(readSettings()).toEqual({ settings: DEFAULT_SETTINGS, error: true });
  expect(saveSettings({ maskSensitive: false })).toBe(false);
  expect(state.values.get(SETTINGS_STORAGE_KEY)).toBe('{"maskSensitive":"yes"}');
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
  expect(searchSettings("  inherited privacy ").map((item) => item.id)).toEqual(["privacy"]);
  expect(searchSettings("no such setting")).toEqual([]);
  expect(resolveSettingsPath("/settings/privacy?focus=privacy")).toMatchObject({
    section: { id: "privacy" },
    target: { id: "privacy" },
    invalidTarget: false,
  });
  expect(resolveSettingsPath("/settings/appearance?focus=privacy").invalidTarget).toBe(true);
  expect(resolveSettingsPath("/settings/missing").section).toBeUndefined();
  expect(resolveSettingsPath("/settings").section?.id).toBe("general");
});

it.each([
  ["الخصوصية", "privacy"],
  ["السمات", "appearance"],
  ["فاتح", "appearance"],
  ["إشعارات سطح المكتب", "notifications"],
])("finds settings by the Arabic concept %s", (query, id) => {
  expect(
    searchSettings(query, (message) => translate("ar", message)).map((item) => item.id),
  ).toContain(id);
});
