import { expect, it, vi } from "vite-plus/test";
import {
  getCustomThemes,
  installCustomTheme,
  updateCustomTheme,
  removeCustomTheme,
  parseThemeFile,
  serializeThemeFile,
  subscribeToCustomThemes,
} from "./themePalette";

function setup(raw?: string) {
  const values = new Map<string, string>(raw ? [["madar:themes:v1", raw]] : []);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const events = new EventTarget();
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const unsubscribe = subscribeToCustomThemes(() => {});
  const reload = () => {
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: null });
    events.dispatchEvent(event);
  };
  reload();
  return {
    values,
    storage,
    reload,
    [Symbol.dispose]: () => {
      unsubscribe();
      vi.unstubAllGlobals();
    },
  };
}
const file = {
  version: 1,
  name: "Kuwait",
  appearance: "light",
  colors: { canvas: "#ffffff", accent: "#228877" },
  variants: { dark: { canvas: "#112233" } },
};

it("round-trips both palettes, edits persist across reload, and removal persists", () => {
  using state = setup();
  const theme = installCustomTheme(parseThemeFile(file));
  expect(parseThemeFile(JSON.parse(serializeThemeFile(theme)))).toEqual(theme);
  const edited = updateCustomTheme({
    ...theme,
    label: "Edited",
    colors: { ...theme.colors, canvas: "#fafafa" },
  });
  state.reload();
  expect(getCustomThemes()).toEqual([edited]);
  removeCustomTheme(theme.id);
  state.reload();
  expect(getCustomThemes()).toEqual([]);
});

it("rejects unsupported files, dynamic colors, invalid variants and duplicate ids without overwriting", () => {
  using state = setup();
  installCustomTheme(parseThemeFile(file));
  const persisted = state.values.get("madar:themes:v1");
  for (const invalid of [
    null,
    { ...file, version: 2 },
    { ...file, colors: { canvas: "var(--background)" } },
    { ...file, colors: { unknown: "red" } },
    { ...file, variants: { light: { canvas: "red" } } },
  ])
    expect(() => parseThemeFile(invalid)).toThrow();
  expect(() => installCustomTheme(parseThemeFile(file))).toThrow(/already installed/);
  expect(state.values.get("madar:themes:v1")).toBe(persisted);
});

it("keeps the previous library after failed writes and recovers on retry", () => {
  using state = setup();
  const theme = installCustomTheme(parseThemeFile(file));
  using _write = vi.spyOn(state.storage, "setItem").mockImplementationOnce(() => {
    throw new Error("full");
  });
  expect(() => updateCustomTheme({ ...theme, label: "New" })).toThrow();
  expect(getCustomThemes()).toEqual([theme]);
  updateCustomTheme({ ...theme, label: "New" });
  state.reload();
  expect(getCustomThemes()[0]?.label).toBe("New");
});

it("protects malformed stored data and recovers after storage is repaired", () => {
  using state = setup("broken");
  expect(() => installCustomTheme(parseThemeFile(file))).toThrow();
  expect(state.values.get("madar:themes:v1")).toBe("broken");
  state.values.set("madar:themes:v1", "[]");
  state.reload();
  installCustomTheme(parseThemeFile(file));
  expect(getCustomThemes()).toHaveLength(1);
});
