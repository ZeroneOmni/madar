import { describe, expect, it } from "vite-plus/test";
import {
  DEFAULT_SHORTCUTS,
  decodeShortcuts,
  matchesShortcut,
  parseShortcut,
  shortcutAllowedInEditor,
  validateShortcuts,
} from "./shortcuts.logic";

describe("shell keyboard shortcuts", () => {
  it("resolves Mod using the active platform and exact modifiers", () => {
    const event = {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(matchesShortcut(event, "Mod+K", false)).toBe(true);
    expect(matchesShortcut(event, "Mod+K", true)).toBe(false);
    expect(matchesShortcut({ ...event, shiftKey: true }, "Mod+K", false)).toBe(false);
    expect(matchesShortcut({ ...event, key: "\u043b" }, "Mod+K", false)).toBe(true);
    expect(matchesShortcut({ ...event, key: "j" }, "Mod+K", false)).toBe(false);
  });

  it("rejects conflicting shortcuts including platform-specific Mod aliases", () => {
    expect(() => validateShortcuts({ ...DEFAULT_SHORTCUTS, usage: "Ctrl+K" })).toThrow(
      "already assigned",
    );
    expect(() => validateShortcuts({ ...DEFAULT_SHORTCUTS, usage: "Meta+K" })).toThrow(
      "already assigned",
    );
    expect(() => validateShortcuts({ ...DEFAULT_SHORTCUTS, usage: "Mod+Shift+K" })).not.toThrow();
  });

  it("rejects unmodified typing, reserved system keys, and malformed bindings", () => {
    for (const value of [
      "A",
      "Shift+A",
      "Mod+Q",
      "Mod+Shift+W",
      "Mod+Ctrl+K",
      "Mod+Mod+K",
      "Alt+Escape",
      "Mod+Unknown",
      "Ctrl+",
    ]) {
      expect(() => parseShortcut(value), value).toThrow();
    }
    expect(parseShortcut("")).toBe(null);
  });

  it("preserves custom removal and validates persisted settings on reload", () => {
    const settings = { ...DEFAULT_SHORTCUTS, palette: "Mod+Shift+P", sidebar: "" };
    expect(decodeShortcuts(JSON.stringify(settings))).toEqual(settings);
    expect(decodeShortcuts(null)).toEqual(DEFAULT_SHORTCUTS);
    expect(() => decodeShortcuts('{"palette":true}')).toThrow();
    expect(() => decodeShortcuts("garbage")).toThrow();
  });

  it("keeps navigation and sidebar shortcuts out of editors", () => {
    expect(shortcutAllowedInEditor("sidebar")).toBe(false);
    expect(shortcutAllowedInEditor("usage")).toBe(false);
    expect(shortcutAllowedInEditor("palette")).toBe(true);
    expect(shortcutAllowedInEditor("settings")).toBe(true);
  });
});

it("rejects native menu accelerators even when the Settings shortcut is reassigned", () => {
  for (const usage of [
    "Mod+M",
    "Ctrl+M",
    "Meta+M",
    "Mod+0",
    "Ctrl+0",
    "Meta+-",
    "Mod+Z",
    "Mod+Shift+V",
    "Ctrl+Shift+I",
    "Meta+Alt+I",
    "Alt+F4",
    "Ctrl+Meta+F",
  ]) {
    expect(() => validateShortcuts({ ...DEFAULT_SHORTCUTS, usage }), usage).toThrow("reserved");
  }
  expect(() =>
    validateShortcuts({ ...DEFAULT_SHORTCUTS, settings: "Mod+Shift+S", usage: "Mod+," }),
  ).toThrow("reserved");
  expect(() => validateShortcuts(DEFAULT_SHORTCUTS)).not.toThrow();
});

it("matches shifted punctuation and number-row keys without treating shifted characters as base keys", () => {
  const event = {
    key: "<",
    code: "Comma",
    ctrlKey: true,
    metaKey: false,
    altKey: false,
    shiftKey: true,
  };
  expect(matchesShortcut(event, "Mod+Shift+,", false)).toBe(true);
  expect(matchesShortcut({ ...event, key: "!", code: "Digit1" }, "Mod+Shift+1", false)).toBe(true);
  expect(matchesShortcut({ ...event, key: "_", code: "Minus" }, "Mod+Shift+-", false)).toBe(true);
  expect(matchesShortcut(event, "Mod+,", false)).toBe(false);
});
