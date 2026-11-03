import * as Schema from "effect/Schema";

export const DEFAULT_SHORTCUTS = {
  palette: "Mod+K",
  settings: "Mod+,",
  sidebar: "Mod+B",
  overview: "Mod+Shift+H",
  vouchers: "",
  subscriptions: "",
  designs: "",
  usage: "",
  notifications: "",
  welcome: "",
} as const;
export type ShellCommandId = keyof typeof DEFAULT_SHORTCUTS;
export type ShellShortcuts = Record<ShellCommandId, string>;
const ShortcutsSchema = Schema.Struct({
  palette: Schema.String,
  settings: Schema.String,
  sidebar: Schema.String,
  overview: Schema.String,
  vouchers: Schema.String,
  subscriptions: Schema.String,
  designs: Schema.String,
  usage: Schema.String,
  notifications: Schema.String,
  welcome: Schema.String,
});

export function parseShortcut(value: string) {
  if (!value.trim()) return null;
  const parts = value
    .toLowerCase()
    .split("+")
    .map((part) => part.trim());
  const key = parts.pop();
  if (
    !key ||
    !/^(?:[a-z0-9=,./;[\]\\'`-]|enter|space|arrowup|arrowdown|arrowleft|arrowright|f[1-9]|f1[0-2])$/.test(
      key,
    )
  ) {
    throw new Error("Use a letter, number, punctuation key, arrow, Enter, Space, or F1–F12.");
  }
  if (
    new Set(parts).size !== parts.length ||
    parts.some((part) => !["mod", "ctrl", "meta", "alt", "shift"].includes(part))
  ) {
    throw new Error("Use modifiers Mod, Ctrl, Meta, Alt, and Shift once each.");
  }
  if (!parts.some((part) => ["mod", "ctrl", "meta", "alt"].includes(part))) {
    throw new Error("Include Mod, Ctrl, Meta, or Alt to preserve typing and navigation.");
  }
  if (parts.includes("mod") && (parts.includes("ctrl") || parts.includes("meta"))) {
    throw new Error("Use Mod or an explicit Ctrl/Meta modifier, not both.");
  }
  if (
    parts.some((part) => ["mod", "ctrl", "meta"].includes(part)) &&
    ["q", "w", "r", "l", "t", "n"].includes(key)
  ) {
    throw new Error("That key is reserved for the desktop or browser.");
  }
  return {
    key,
    mod: parts.includes("mod"),
    ctrl: parts.includes("ctrl"),
    meta: parts.includes("meta"),
    alt: parts.includes("alt"),
    shift: parts.includes("shift"),
  };
}

function shortcutConflictKey(value: string, mac: boolean) {
  const shortcut = parseShortcut(value);
  return shortcut
    ? [
        shortcut.key,
        shortcut.ctrl || (shortcut.mod && !mac),
        shortcut.meta || (shortcut.mod && mac),
        shortcut.alt,
        shortcut.shift,
      ].join(":")
    : null;
}

const NATIVE_SHORTCUTS = [
  "Mod+,",
  "Mod+0",
  "Mod+-",
  "Mod+=",
  "Mod+Shift+=",
  "Mod+Z",
  "Mod+Shift+Z",
  "Mod+X",
  "Mod+C",
  "Mod+V",
  "Mod+Shift+V",
  "Mod+A",
  "Ctrl+Y",
  "Ctrl+Shift+I",
  "Meta+Alt+I",
  "Meta+H",
  "Meta+Alt+H",
  "Mod+M",
  "Ctrl+Meta+F",
  "Alt+F4",
];
const SHIFTED_BASE_KEYS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Minus: "-",
  Equal: "=",
  Digit0: "0",
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
};

const decodeShortcutMap = Schema.decodeUnknownSync(ShortcutsSchema);

export function validateShortcuts(value: unknown): ShellShortcuts {
  const shortcuts = decodeShortcutMap(value);
  for (const mac of [false, true]) {
    const used = new Set<string>();
    const reserved = new Set(NATIVE_SHORTCUTS.map((binding) => shortcutConflictKey(binding, mac)));
    for (const [command, binding] of Object.entries(shortcuts)) {
      const key = shortcutConflictKey(binding, mac);
      if (
        key &&
        reserved.has(key) &&
        !(command === "settings" && key === shortcutConflictKey("Mod+,", mac))
      )
        throw new Error("That key is reserved for the desktop or browser.");
      if (key && used.has(key))
        throw new Error("That shortcut is already assigned to another command.");
      if (key) used.add(key);
    }
  }
  return shortcuts;
}

export function decodeShortcuts(serialized: string | null) {
  return serialized === null ? { ...DEFAULT_SHORTCUTS } : validateShortcuts(JSON.parse(serialized));
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  value: string,
  mac: boolean,
) {
  const shortcut = parseShortcut(value);
  if (!shortcut) return false;
  const rawKey = event.key.toLowerCase();
  // Physical fallback preserves shortcuts on layouts whose letters are non-Latin.
  const baseKey =
    rawKey.length === 1 && rawKey.charCodeAt(0) > 127 && /^Key[A-Z]$/.test(event.code)
      ? event.code.slice(3).toLowerCase()
      : rawKey === " "
        ? "space"
        : rawKey;
  const key = event.shiftKey ? (SHIFTED_BASE_KEYS[event.code] ?? baseKey) : baseKey;
  return (
    key === shortcut.key &&
    event.ctrlKey === (shortcut.ctrl || (shortcut.mod && !mac)) &&
    event.metaKey === (shortcut.meta || (shortcut.mod && mac)) &&
    event.altKey === shortcut.alt &&
    event.shiftKey === shortcut.shift
  );
}

export function shortcutAllowedInEditor(command: ShellCommandId) {
  return command === "palette" || command === "settings";
}
