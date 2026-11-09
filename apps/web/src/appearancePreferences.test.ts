import { expect, it, vi } from "vite-plus/test";
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  decodeAppearance,
  saveAppearance,
  applyAppearancePreferences,
} from "./appearancePreferences";
import { searchSettings, resolveSettingsPath } from "./shell/settingsSearch";
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
it("persists appearance edits and resets one preference without changing others", () => {
  using state = setup();
  expect(decodeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  expect(
    saveAppearance({ fontFamilySans: "Arial", fontSizeInterface: 18, glassOpacity: 100 }),
  ).toBe(true);
  expect(saveAppearance({ fontSizeInterface: DEFAULT_APPEARANCE.fontSizeInterface })).toBe(true);
  expect(decodeAppearance(state.values.get(APPEARANCE_STORAGE_KEY) ?? null)).toEqual({
    ...DEFAULT_APPEARANCE,
    fontFamilySans: "Arial",
    glassOpacity: 100,
  });
});
it.each([
  { fontSizeInterface: 21 },
  { glassOpacity: 39 },
  { panelAnimationDurationMs: -1 },
  { appearanceContrast: 201 },
  { fontSizeMono: 13.5 },
])("rejects out-of-range preferences %j without losing saved state", (update) => {
  using state = setup();
  saveAppearance({ fontSizeInterface: 18 });
  expect(saveAppearance(update)).toBe(false);
  expect(decodeAppearance(state.values.get(APPEARANCE_STORAGE_KEY) ?? null).fontSizeInterface).toBe(
    18,
  );
});
it("preserves previous preferences on storage failure and recovers corrupt data explicitly", () => {
  using state = setup();
  saveAppearance({ fontSizeMono: 16 });
  using _write = vi.spyOn(state.storage, "setItem").mockImplementationOnce(() => {
    throw new Error("blocked");
  });
  expect(saveAppearance({ fontSizeMono: 18 })).toBe(false);
  expect(decodeAppearance(state.values.get(APPEARANCE_STORAGE_KEY) ?? null).fontSizeMono).toBe(16);
  state.values.set(APPEARANCE_STORAGE_KEY, "broken");
  expect(saveAppearance({ glassOpacity: 100 })).toBe(false);
  expect(saveAppearance({}, true)).toBe(true);
  expect(decodeAppearance(state.values.get(APPEARANCE_STORAGE_KEY) ?? null)).toEqual(
    DEFAULT_APPEARANCE,
  );
});
it("applies readable fonts, contrast, opacity and motion to the document and restores defaults", () => {
  const variables = new Map<string, string>();
  const style = {
    fontSize: "",
    setProperty: (key: string, value: string) => {
      variables.set(key, value);
    },
  };
  const root = { style, dataset: { panelAnimations: "" } };
  applyAppearancePreferences(root, {
    ...DEFAULT_APPEARANCE,
    fontFamilyMono: "Cascadia Mono",
    fontSizeInterface: 20,
    fontSizeMono: 18,
    appearanceContrast: 180,
    glassOpacity: 100,
    panelAnimationDurationMs: 250,
  });
  expect(style.fontSize).toBe("20px");
  expect(variables.get("--font-mono")).toContain('"Cascadia Mono"');
  expect(variables.get("--font-size-mono")).toBe("18px");
  expect(variables.get("--appearance-contrast-boost")).toBe("80%");
  expect(variables.get("--appearance-contrast-border-boost")).toBe("20%");
  expect(variables.get("--glass-opacity")).toBe("100%");
  expect(root.dataset.panelAnimations).toBe("true");
  applyAppearancePreferences(root, DEFAULT_APPEARANCE);
  expect(root.dataset.panelAnimations).toBe("false");
  expect(variables.get("--panel-animation-duration")).toBe("0ms");
});
it.each(["interface-font", "monospace-font", "contrast", "glass-opacity", "panel-animations"])(
  "finds and resolves the restored setting %s",
  (id) => {
    const item = searchSettings("").find((item) => item.id === id)!;
    expect(searchSettings(item.title)).toContainEqual(item);
    expect(resolveSettingsPath(`/settings/appearance?focus=${id}`).target).toEqual(item);
  },
);
