import * as Schema from "effect/Schema";
import "culori/css";
import { converter, parse } from "culori/fn";
import {
  BUILT_IN_THEMES,
  EMBER_THEME,
  GROVE_THEME,
  IRIS_THEME,
  OCEAN_THEME,
  T3_CHAT_THEME,
  RESERVED_THEME_IDS,
  THEME_COLOR_ROLES,
  type ThemeAppearance,
  type ThemeColorRole,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeVariants,
} from "@madar/shared/themePalettes";

export { EMBER_THEME, GROVE_THEME, IRIS_THEME, OCEAN_THEME, THEME_COLOR_ROLES };
export type { ThemeAppearance, ThemeColorRole, ThemeColors, ThemeDefinition, ThemeVariants };

const T3_CHAT_THEME_ID = "t3-chat" as const;
const GROVE_THEME_ID = "grove" as const;
const OCEAN_THEME_ID = "ocean" as const;
const EMBER_THEME_ID = "ember" as const;
const IRIS_THEME_ID = "iris" as const;
const THEME_FILE_VERSION = 1 as const;
const CUSTOM_THEMES_STORAGE_KEY = "madar:themes:v1";

const LEGACY_T3_CHAT_DARK_THEME_ID = "t3-chat-dark";

export const ThemePreference = Schema.String;
export type ThemePreference = typeof ThemePreference.Type;

const THEME_COLOR_ROLE_SET: ReadonlySet<string> = new Set(THEME_COLOR_ROLES);
export type ThemeColorOverrides = Readonly<Partial<Record<ThemeColorRole, string>>>;
export type ThemeVariantOverrides = Readonly<Partial<Record<ThemeAppearance, ThemeColorOverrides>>>;
export type ThemePreferenceMode = ThemeAppearance | "system";
export type ThemeCollection = Readonly<{ id: string; label: string }>;
export type ThemeFile = Readonly<{
  version: typeof THEME_FILE_VERSION;
  id: string;
  name: string;
  appearance: ThemeAppearance;
  colors: ThemeColorOverrides;
  variants?: ThemeVariantOverrides;
  collection?: ThemeCollection;
  managed?: boolean;
}>;

const customThemeListeners = new Set<() => void>();
type CustomThemeLibrarySnapshot =
  | Readonly<{
      status: "ready";
      storedThemes: ReadonlyArray<unknown>;
      themes: ReadonlyArray<ThemeDefinition>;
    }>
  | Readonly<{ status: "unavailable"; reason: "malformed" }>
  | Readonly<{ status: "unavailable"; reason: "storage-unavailable"; cause: unknown }>;

let customThemeLibrarySnapshot: CustomThemeLibrarySnapshot | null = null;
const themePreviewListeners = new Set<() => void>();
let themePreviewAppearance: ThemeAppearance | null = null;

export function getThemePreviewAppearance(): ThemeAppearance | null {
  return themePreviewAppearance;
}

export function subscribeToThemePreview(listener: () => void): () => void {
  themePreviewListeners.add(listener);
  return () => themePreviewListeners.delete(listener);
}

function setThemePreviewAppearance(appearance: ThemeAppearance | null): void {
  if (themePreviewAppearance === appearance) return;
  themePreviewAppearance = appearance;
  for (const listener of themePreviewListeners) listener();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isThemeAppearance(value: unknown): value is ThemeAppearance {
  return value === "light" || value === "dark";
}

export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && toCanonicalThemeColor(value) !== null;
}

function isThemeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9](?:[a-z0-9-]{0,47})$/.test(value);
}

function isThemeLabel(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 48;
}

function parseThemeCollection(value: unknown): ThemeCollection | undefined {
  return isRecord(value) &&
    typeof value.id === "string" &&
    /^[a-z0-9][a-z0-9.:-]{0,127}$/i.test(value.id) &&
    isThemeLabel(value.label)
    ? { id: value.id, label: value.label.trim() }
    : undefined;
}

function lenientThemeColorOverrides(
  value: Readonly<Record<string, unknown>>,
): Partial<Record<ThemeColorRole, string>> {
  const overrides: Partial<Record<ThemeColorRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    const normalized = toCanonicalThemeColor(color);
    if (THEME_COLOR_ROLE_SET.has(role) && normalized) {
      overrides[role as ThemeColorRole] = normalized;
    }
  }
  return overrides;
}

function parseStoredThemeColors(value: unknown, appearance: ThemeAppearance): ThemeColors | null {
  if (!isRecord(value)) return null;
  return { ...getDefaultThemeColors(appearance), ...lenientThemeColorOverrides(value) };
}

function parseStoredThemeVariants(
  value: unknown,
  baseAppearance: ThemeAppearance,
): ThemeVariants | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {};
  for (const [appearance, colors] of Object.entries(value)) {
    if (!isThemeAppearance(appearance)) return null;
    // Base colors shadow a matching variant; drop it for parseThemeFile round-trips.
    if (appearance === baseAppearance) continue;
    const parsedColors = parseStoredThemeColors(colors, appearance);
    if (!parsedColors) return null;
    variants[appearance] = parsedColors;
  }
  return Object.keys(variants).length > 0 ? variants : undefined;
}

function parseStoredTheme(value: unknown): ThemeDefinition | null {
  if (!isRecord(value)) return null;
  if (!isThemeId(value.id) || RESERVED_THEME_IDS.has(value.id)) return null;
  if (!isThemeLabel(value.label) || !isThemeAppearance(value.appearance)) return null;
  const colors = parseStoredThemeColors(value.colors, value.appearance);
  if (!colors) return null;
  const variants = parseStoredThemeVariants(value.variants, value.appearance);
  if (value.variants !== undefined && variants === null) return null;
  const collection = parseThemeCollection(value.collection);

  return {
    id: value.id,
    label: value.label.trim(),
    appearance: value.appearance,
    colors,
    ...(variants ? { variants } : {}),
    ...(collection ? { collection } : {}),
    ...(value.managed === true ? { managed: true } : {}),
  };
}

function parseStoredThemes(storedThemes: ReadonlyArray<unknown>): ReadonlyArray<ThemeDefinition> {
  const themes: ThemeDefinition[] = [];
  for (const value of storedThemes) {
    const theme = parseStoredTheme(value);
    if (theme && !themes.some((existing) => existing.id === theme.id)) {
      themes.push(theme);
    }
  }
  return themes;
}

function readCustomThemeLibrarySnapshot(): CustomThemeLibrarySnapshot {
  if (typeof window === "undefined") {
    return { status: "ready", storedThemes: [], themes: [] };
  }

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(CUSTOM_THEMES_STORAGE_KEY);
  } catch (cause) {
    return { status: "unavailable", reason: "storage-unavailable", cause };
  }
  if (!raw) return { status: "ready", storedThemes: [], themes: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "unavailable", reason: "malformed" };
  }
  if (!Array.isArray(parsed)) return { status: "unavailable", reason: "malformed" };

  return { status: "ready", storedThemes: parsed, themes: parseStoredThemes(parsed) };
}

function getCustomThemeLibrarySnapshot(): CustomThemeLibrarySnapshot {
  if (customThemeLibrarySnapshot === null) {
    customThemeLibrarySnapshot = readCustomThemeLibrarySnapshot();
  }
  return customThemeLibrarySnapshot;
}

function notifyCustomThemeListeners() {
  for (const listener of customThemeListeners) listener();
}

function invalidateCustomThemes() {
  customThemeLibrarySnapshot = null;
  notifyCustomThemeListeners();
}

const EMPTY_CUSTOM_THEMES: ReadonlyArray<ThemeDefinition> = [];

export function getCustomThemes(): ReadonlyArray<ThemeDefinition> {
  const snapshot = getCustomThemeLibrarySnapshot();
  return snapshot.status === "ready" ? snapshot.themes : EMPTY_CUSTOM_THEMES;
}

export function subscribeToCustomThemes(listener: () => void): () => void {
  customThemeListeners.add(listener);
  if (typeof window === "undefined") {
    return () => customThemeListeners.delete(listener);
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === CUSTOM_THEMES_STORAGE_KEY || event.key === null) {
      invalidateCustomThemes();
    }
  };
  window.addEventListener("storage", handleStorage);

  return () => {
    customThemeListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

const LEGACY_THEME_ID_ALIASES: Readonly<Record<string, string>> = {
  [LEGACY_T3_CHAT_DARK_THEME_ID]: T3_CHAT_THEME_ID,
  "t3-grove": GROVE_THEME_ID,
  "t3-ocean": OCEAN_THEME_ID,
  "t3-ember": EMBER_THEME_ID,
  "t3-iris": IRIS_THEME_ID,
};

function normalizeThemeId(themeId: string): string {
  return LEGACY_THEME_ID_ALIASES[themeId] ?? themeId;
}

function themeIdFromPreference(theme: ThemePreference): string {
  return normalizeThemeId(theme);
}

function legacyThemeMode(theme: ThemePreference): ThemeAppearance | null {
  return theme === LEGACY_T3_CHAT_DARK_THEME_ID ? "dark" : null;
}

type ThemeRgbColor = {
  r: number;
  g: number;
  b: number;
};

type ThemeOklch = { L: number; C: number; h: number };
type ParsedThemeColor = { color: ThemeOklch; alpha: number };

const THEME_LIGHT_FOREGROUND: ThemeRgbColor = { r: 255, g: 250, b: 255 };
const THEME_DARK_FOREGROUND: ThemeRgbColor = { r: 36, g: 21, b: 35 };
const THEME_WHITE_FOREGROUND: ThemeRgbColor = { r: 255, g: 255, b: 255 };
const THEME_BLACK_FOREGROUND: ThemeRgbColor = { r: 0, g: 0, b: 0 };

const convertToOklch = converter("oklch");

function parseThemeColor(value: unknown): ParsedThemeColor | null {
  if (typeof value !== "string") return null;
  const input = value.trim();
  const parsed = parse(input);
  if (!parsed) return null;
  const color = convertToOklch(parsed);
  const lightness = color.l ?? 0;
  const chroma = color.c ?? 0;
  const hue = color.h ?? 0;
  // Missing CSS components are zero; Culori omits none alpha, so distinguish it from absent alpha.
  const alpha = /\/\s*none\s*\)$/i.test(input) ? 0 : (color.alpha ?? 1);
  if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return null;
  return {
    color: {
      L: Math.min(1, Math.max(0, lightness)),
      C: Math.max(0, chroma),
      h: hue,
    },
    alpha: Math.min(1, Math.max(0, alpha)),
  };
}

function formatThemeColorNumber(value: number, precision: number): string {
  const rounded = Math.abs(value) < 10 ** -precision / 2 ? 0 : value;
  return rounded.toFixed(precision).replace(/(?:\.0+|(?:(\.[0-9]*?)0+))$/, "$1");
}

function formatOklchThemeColor(color: ThemeOklch, alpha = 1): string {
  const normalizedHue = color.C < 0.0000005 ? 0 : ((color.h % 360) + 360) % 360;
  const body = `${formatThemeColorNumber(color.L, 6)} ${formatThemeColorNumber(color.C, 6)} ${formatThemeColorNumber(normalizedHue, 3)}`;
  return alpha < 1 ? `oklch(${body} / ${formatThemeColorNumber(alpha, 4)})` : `oklch(${body})`;
}

function toCanonicalThemeColor(value: unknown): string | null {
  const parsed = parseThemeColor(value);
  return parsed ? formatOklchThemeColor(parsed.color, parsed.alpha) : null;
}

export function themeColorToHex(value: string): string | null {
  const color = parseThemeColor(value);
  const parsed = color ? { rgb: themeOklchToRgb(color.color), alpha: color.alpha } : null;
  if (!parsed) return null;

  const opaque = themeRgbToHexColor(parsed.rgb);
  if (parsed.alpha >= 1) return opaque;
  const alpha = Math.round(parsed.alpha * 255)
    .toString(16)
    .padStart(2, "0");
  return `${opaque}${alpha}`;
}

function parseThemeRgbColor(value: string, fallback: ThemeRgbColor): ThemeRgbColor {
  const parsed = parseThemeColor(value);
  return parsed ? themeOklchToRgb(parsed.color) : fallback;
}

function themeRgbToHexColor(color: ThemeRgbColor): string {
  return `#${[color.r, color.g, color.b]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function themeRgbToThemeColor(color: ThemeRgbColor): string {
  return formatOklchThemeColor(themeRgbToOklch(color));
}

function decodeThemeColors(colors: ThemeColors): ThemeColors {
  return Object.fromEntries(
    THEME_COLOR_ROLES.map((role) => {
      const color = toCanonicalThemeColor(colors[role]);
      if (!color) {
        throw new Error(
          `The color for "${role}" must be a literal CSS color such as oklch(0.62 0.2 280).`,
        );
      }
      return [role, color];
    }),
  ) as Record<ThemeColorRole, string>;
}

function canonicalizeThemeDefinition(theme: ThemeDefinition): ThemeDefinition {
  return {
    ...theme,
    colors: decodeThemeColors(theme.colors),
    ...(theme.variants
      ? {
          variants: Object.fromEntries(
            Object.entries(theme.variants).map(([appearance, colors]) => [
              appearance,
              decodeThemeColors(colors),
            ]),
          ) as ThemeVariants,
        }
      : {}),
  };
}

function mixThemeRgbColors(
  base: ThemeRgbColor,
  overlay: ThemeRgbColor,
  amount: number,
): ThemeRgbColor {
  return {
    r: base.r + (overlay.r - base.r) * amount,
    g: base.g + (overlay.g - base.g) * amount,
    b: base.b + (overlay.b - base.b) * amount,
  };
}

function themeRelativeLuminance(color: ThemeRgbColor): number {
  const linearize = (channel: number) => {
    const normalized = channel / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

function srgbChannelToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(channel: number): number {
  const c = channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}

function themeRgbToOklch(color: ThemeRgbColor): ThemeOklch {
  const r = srgbChannelToLinear(color.r);
  const g = srgbChannelToLinear(color.g);
  const b = srgbChannelToLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: (Math.atan2(bb, a) * 180) / Math.PI };
}

function oklchToRgbUnclamped({ L, C, h }: ThemeOklch): { r: number; g: number; b: number } {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const bb = C * Math.sin(hr);
  const l = (L + 0.3963377774 * a + 0.2158037573 * bb) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * bb) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * bb) ** 3;
  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

function mapThemeOklchToSrgbGamut(color: ThemeOklch): ThemeOklch {
  const isInGamut = (C: number) => {
    const linear = oklchToRgbUnclamped({ ...color, C });
    return [linear.r, linear.g, linear.b].every(
      (channel) => channel >= -0.0001 && channel <= 1.0001,
    );
  };
  if (isInGamut(color.C)) return color;

  let low = 0;
  let high = color.C;
  const chromaResolution = 0.000001;
  const steps = Math.max(
    1,
    Math.ceil(Math.log2(Math.max(color.C, chromaResolution)) - Math.log2(chromaResolution)),
  );
  for (let step = 0; step < steps; step += 1) {
    const mid = (low + high) / 2;
    if (isInGamut(mid)) low = mid;
    else high = mid;
  }
  return { ...color, C: low };
}

function themeOklchToRgb(color: ThemeOklch): ThemeRgbColor {
  const linear = oklchToRgbUnclamped(mapThemeOklchToSrgbGamut(color));
  return {
    r: linearChannelToSrgb(linear.r),
    g: linearChannelToSrgb(linear.g),
    b: linearChannelToSrgb(linear.b),
  };
}

function themeOklchToThemeColor(color: ThemeOklch): string {
  return formatOklchThemeColor(mapThemeOklchToSrgbGamut(color));
}

function solveOklchLightness(
  base: ThemeOklch,
  against: ThemeRgbColor,
  minContrast: number,
  direction: "lighter" | "darker",
): ThemeOklch {
  let low = direction === "lighter" ? base.L : 0;
  let high = direction === "lighter" ? 1 : base.L;
  let candidate = { ...base };
  if (themeContrastRatio(themeOklchToRgb(candidate), against) >= minContrast) return candidate;
  for (let step = 0; step < 18; step += 1) {
    const mid = (low + high) / 2;
    candidate = { ...base, L: mid };
    const contrast = themeContrastRatio(themeOklchToRgb(candidate), against);
    if (contrast >= minContrast) {
      if (direction === "lighter") high = mid;
      else low = mid;
    } else {
      if (direction === "lighter") low = mid;
      else high = mid;
    }
  }
  return { ...base, L: direction === "lighter" ? high : low };
}

/**
 * Moves only the lightness, so a color that is too dim on `surface` keeps its
 * hue instead of collapsing to black or white.
 */

function themeContrastRatio(first: ThemeRgbColor, second: ThemeRgbColor): number {
  const firstLuminance = themeRelativeLuminance(first);
  const secondLuminance = themeRelativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function readableThemeForeground(background: ThemeRgbColor): ThemeRgbColor {
  const lightContrast = themeContrastRatio(background, THEME_LIGHT_FOREGROUND);
  const darkContrast = themeContrastRatio(background, THEME_DARK_FOREGROUND);
  if (Math.max(lightContrast, darkContrast) >= 4.5) {
    return lightContrast >= darkContrast ? THEME_LIGHT_FOREGROUND : THEME_DARK_FOREGROUND;
  }

  return themeContrastRatio(background, THEME_WHITE_FOREGROUND) >=
    themeContrastRatio(background, THEME_BLACK_FOREGROUND)
    ? THEME_WHITE_FOREGROUND
    : THEME_BLACK_FOREGROUND;
}

export function getDefaultThemeColors(appearance: ThemeAppearance): ThemeColors {
  return appearance === "dark" ? T3_CHAT_THEME.variants!.dark! : T3_CHAT_THEME.colors;
}

export function updateThemeColorFamily(
  appearance: ThemeAppearance,
  colors: ThemeColors,
  role: ThemeColorRole,
  value: string,
): ThemeColors {
  const parsedSelected = parseThemeColor(value);
  if (!parsedSelected) return { ...colors, [role]: value };
  const normalized = formatOklchThemeColor(parsedSelected.color, parsedSelected.alpha);

  const canvas = parseThemeRgbColor(
    colors.canvas,
    appearance === "dark" ? { r: 24, g: 15, b: 27 } : { r: 250, g: 245, b: 250 },
  );
  const selected = themeOklchToRgb(parsedSelected.color);
  const selectedOn = (background: ThemeRgbColor) =>
    mixThemeRgbColors(background, selected, parsedSelected.alpha);
  const selectedOnCanvas = selectedOn(canvas);
  const accent = parseThemeRgbColor(colors.accent, { r: 168, g: 67, b: 112 });
  const canvasIsDark = themeRelativeLuminance(canvas) < 0.179;
  const terminalIsDark = themeRelativeLuminance(selectedOnCanvas) < 0.179;
  const colorOf = (color: ThemeRgbColor) => themeRgbToThemeColor(color);
  const foregroundOn = (background: ThemeRgbColor) => colorOf(readableThemeForeground(background));
  const selectedToneOn = (background: ThemeRgbColor) =>
    themeOklchToThemeColor(
      solveOklchLightness(
        parsedSelected.color,
        background,
        4.6,
        themeRelativeLuminance(background) < 0.179 ? "lighter" : "darker",
      ),
    );
  const statusColors = () => {
    const surface = mixThemeRgbColors(canvas, selectedOnCanvas, canvasIsDark ? 0.16 : 0.08);
    return {
      foreground: selectedToneOn(surface),
      surface: colorOf(surface),
    };
  };

  switch (role) {
    case "canvas":
      return { ...colors, canvas: normalized, chrome: normalized, toolbar: normalized };
    case "surface":
    case "surfaceRaised":
    case "surfaceOverlay":
    case "input":
    case "sidebarControlSurface":
      return { ...colors, [role]: normalized };
    case "text":
      return {
        ...colors,
        text: normalized,
        toolbarForeground: normalized,
        toolbarControlForeground: normalized,
      };
    case "mutedForeground":
      return {
        ...colors,
        textMuted: normalized,
        mutedForeground: normalized,
        placeholder: normalized,
        secondaryLabel: normalized,
        iconMuted: normalized,
        sidebarMutedForeground: normalized,
      };
    case "border":
      return {
        ...colors,
        border: normalized,
        toolbarBorder: normalized,
        sidebarBorder: normalized,
      };
    case "secondary":
      return {
        ...colors,
        secondary: normalized,
        secondaryForeground: foregroundOn(selectedOnCanvas),
        muted: normalized,
        toolbarControl: normalized,
      };
    case "accentSurface":
      return {
        ...colors,
        accentSurface: normalized,
        accentSurfaceForeground: foregroundOn(selectedOnCanvas),
        toolbarControlHover: normalized,
      };
    case "accent": {
      const updateSurface = mixThemeRgbColors(canvas, selectedOnCanvas, canvasIsDark ? 0.32 : 0.16);
      return {
        ...colors,
        accent: normalized,
        accentForeground: foregroundOn(selectedOnCanvas),
        focus: normalized,
        update: normalized,
        updateForeground: selectedToneOn(updateSurface),
        updateSurface: colorOf(updateSurface),
        terminalCursor: normalized,
      };
    }
    case "messageAction": {
      const actionForeground = readableThemeForeground(selectedOnCanvas);
      const towardOpposite =
        actionForeground === THEME_LIGHT_FOREGROUND || actionForeground === THEME_WHITE_FOREGROUND
          ? THEME_BLACK_FOREGROUND
          : THEME_WHITE_FOREGROUND;
      const actionHover = mixThemeRgbColors(selected, towardOpposite, 0.12);
      return {
        ...colors,
        messageAction: normalized,
        messageActionForeground: colorOf(actionForeground),
        messageActionHover: formatOklchThemeColor(
          themeRgbToOklch(actionHover),
          parsedSelected.alpha,
        ),
      };
    }
    case "messageSurface":
      return {
        ...colors,
        messageSurface: normalized,
        messageForeground: foregroundOn(selectedOnCanvas),
      };
    case "searchMatchBackground":
      return {
        ...colors,
        searchMatchBackground: colorOf(selectedOnCanvas),
        searchMatchForeground: foregroundOn(selectedOnCanvas),
      };
    case "searchMatchActiveBackground":
      return {
        ...colors,
        searchMatchActiveBackground: colorOf(selectedOnCanvas),
        searchMatchActiveForeground: foregroundOn(selectedOnCanvas),
      };
    case "codeBackground":
      return {
        ...colors,
        codeBackground: normalized,
        codeForeground: foregroundOn(selectedOnCanvas),
      };
    case "sidebar":
      return {
        ...colors,
        sidebar: normalized,
        sidebarForeground: foregroundOn(selectedOnCanvas),
      };
    case "sidebarRowSelected": {
      const sidebar = parseThemeRgbColor(colors.sidebar, canvas);
      const selectedOnSidebar = selectedOn(sidebar);
      return {
        ...colors,
        sidebarRowHover: colorOf(mixThemeRgbColors(sidebar, selectedOnSidebar, 0.5)),
        sidebarRowActive: colorOf(mixThemeRgbColors(sidebar, selectedOnSidebar, 0.8)),
        sidebarRowSelected: normalized,
      };
    }
    case "terminalBackground": {
      const terminalForeground = readableThemeForeground(selectedOnCanvas);
      return {
        ...colors,
        terminalBackground: normalized,
        terminalForeground: colorOf(terminalForeground),
        terminalSelection: colorOf(
          mixThemeRgbColors(selectedOnCanvas, accent, terminalIsDark ? 0.35 : 0.18),
        ),
        terminalScrollbar: colorOf(
          mixThemeRgbColors(selectedOnCanvas, terminalForeground, terminalIsDark ? 0.42 : 0.22),
        ),
        terminalScrollbarHover: colorOf(
          mixThemeRgbColors(selectedOnCanvas, terminalForeground, terminalIsDark ? 0.55 : 0.32),
        ),
      };
    }
    case "error": {
      const status = statusColors();
      return {
        ...colors,
        error: normalized,
        errorForeground: status.foreground,
        errorSurface: status.surface,
      };
    }
    case "warning": {
      const status = statusColors();
      return {
        ...colors,
        warning: normalized,
        warningForeground: status.foreground,
        warningSurface: status.surface,
      };
    }
    default:
      return { ...colors, [role]: normalized };
  }
}

const BUILT_IN_THEME_DEFINITIONS: ReadonlyArray<ThemeDefinition> = BUILT_IN_THEMES;

export function getThemeDefinition(theme: ThemePreference): ThemeDefinition | null {
  const themeId = themeIdFromPreference(theme);
  return (
    BUILT_IN_THEME_DEFINITIONS.find((definition) => definition.id === themeId) ??
    getCustomThemes().find((definition) => definition.id === themeId) ??
    null
  );
}

/** Every selection path must check single-appearance themes to keep mix and appearance tiles in sync. */

export function getThemeColorsForMode(
  theme: ThemeDefinition,
  mode: ThemeAppearance,
): ThemeColors | null {
  if (mode === theme.appearance) return theme.colors;
  return theme.variants?.[mode] ?? null;
}

function themeIdFromName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return normalized || "custom-theme";
}

export class ThemeLibraryStorageError extends Schema.TaggedError<ThemeLibraryStorageError>()(
  "ThemeLibraryStorageError",
  {
    storageKey: Schema.String,
    operation: Schema.Literals(["read", "write"]),
    reason: Schema.Literals(["malformed", "storage-unavailable"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    const direction = this.operation === "read" ? "from" : "to";
    return `Failed to ${this.operation} the theme library ${direction} ${this.storageKey}.`;
  }
}

function saveCustomThemes(
  storedThemes: ReadonlyArray<unknown>,
  themes: ReadonlyArray<ThemeDefinition>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CUSTOM_THEMES_STORAGE_KEY, JSON.stringify(storedThemes));
    customThemeLibrarySnapshot = { status: "ready", storedThemes, themes };
  } catch (cause) {
    throw new ThemeLibraryStorageError({
      storageKey: CUSTOM_THEMES_STORAGE_KEY,
      operation: "write",
      reason: "storage-unavailable",
      cause,
    });
  }
  notifyCustomThemeListeners();
}

function requireWritableCustomThemeLibrary(
  snapshot: CustomThemeLibrarySnapshot,
): Extract<CustomThemeLibrarySnapshot, { status: "ready" }> {
  if (snapshot.status === "unavailable") {
    throw new ThemeLibraryStorageError({
      storageKey: CUSTOM_THEMES_STORAGE_KEY,
      operation: "read",
      reason: snapshot.reason,
      ...("cause" in snapshot ? { cause: snapshot.cause } : {}),
    });
  }
  return snapshot;
}

function getWritableCustomThemeLibrary(): Extract<CustomThemeLibrarySnapshot, { status: "ready" }> {
  return requireWritableCustomThemeLibrary(getCustomThemeLibrarySnapshot());
}

function storedThemeHasId(storedTheme: unknown, themeId: string): boolean {
  return isRecord(storedTheme) && storedTheme.id === themeId;
}

export function installCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  if (RESERVED_THEME_IDS.has(theme.id)) {
    throw new Error(`The theme id "${theme.id}" is reserved.`);
  }
  const library = getWritableCustomThemeLibrary();
  if (
    BUILT_IN_THEME_DEFINITIONS.some((existing) => existing.id === theme.id) ||
    library.storedThemes.some((storedTheme) => storedThemeHasId(storedTheme, theme.id))
  ) {
    throw new Error(`A theme named "${theme.label}" is already installed.`);
  }
  const canonicalTheme = canonicalizeThemeDefinition(theme);
  const themes = [...library.themes, canonicalTheme];
  saveCustomThemes([...library.storedThemes, canonicalTheme], themes);
  return canonicalTheme;
}

export function updateCustomTheme(theme: ThemeDefinition): ThemeDefinition {
  if (RESERVED_THEME_IDS.has(theme.id)) {
    throw new Error(`The theme id "${theme.id}" is reserved.`);
  }

  const library = getWritableCustomThemeLibrary();
  const themes = library.themes;
  const themeIndex = themes.findIndex((existing) => existing.id === theme.id);
  if (themeIndex === -1) {
    throw new Error(`The theme "${theme.label}" is not installed.`);
  }

  const canonicalTheme = canonicalizeThemeDefinition(theme);
  const nextThemes = [...themes];
  nextThemes[themeIndex] = canonicalTheme;

  const nextStoredThemes: unknown[] = [];
  let replaced = false;
  for (const storedTheme of library.storedThemes) {
    if (!storedThemeHasId(storedTheme, theme.id)) {
      nextStoredThemes.push(storedTheme);
    } else if (!replaced) {
      nextStoredThemes.push(canonicalTheme);
      replaced = true;
    }
  }
  saveCustomThemes(nextStoredThemes, nextThemes);
  return canonicalTheme;
}

export function removeCustomTheme(themeId: string): void {
  removeCustomThemes([themeId]);
}

function removeCustomThemes(themeIds: ReadonlyArray<string>): void {
  const removedIds = new Set(themeIds);
  if (removedIds.size === 0) return;
  const library = getWritableCustomThemeLibrary();
  const nextThemes = library.themes.filter((theme) => !removedIds.has(theme.id));
  if (nextThemes.length === library.themes.length) return;
  saveCustomThemes(
    library.storedThemes.filter(
      (storedTheme) =>
        !isRecord(storedTheme) ||
        typeof storedTheme.id !== "string" ||
        !removedIds.has(storedTheme.id),
    ),
    nextThemes,
  );
}

function parseThemeColorOverrides(value: unknown): ThemeColorOverrides {
  if (!isRecord(value)) throw new Error("Theme colors must be objects.");

  const overrides: Partial<Record<ThemeColorRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (!THEME_COLOR_ROLE_SET.has(role)) {
      throw new Error(`"${role}" is not a supported theme color role.`);
    }
    const normalized = toCanonicalThemeColor(color);
    if (!normalized) {
      throw new Error(
        `The color for "${role}" must be a literal CSS color such as oklch(0.62 0.2 280).`,
      );
    }
    overrides[role as ThemeColorRole] = normalized;
  }
  if (Object.keys(overrides).length === 0) {
    throw new Error("Add at least one color role to the theme file.");
  }
  return overrides;
}

export function parseThemeFile(value: unknown): ThemeDefinition {
  if (!isRecord(value)) {
    throw new Error("Theme files must contain a JSON object.");
  }
  if (value.version !== THEME_FILE_VERSION) {
    throw new Error(`This theme file uses an unsupported version. Expected ${THEME_FILE_VERSION}.`);
  }

  const name = value.name;
  const appearance = value.appearance;
  const rawColors = value.colors;
  if (!isThemeLabel(name)) throw new Error("Theme files need a name (48 characters or fewer).");
  if (!isThemeAppearance(appearance)) {
    throw new Error('Theme files need an appearance of "light" or "dark".');
  }
  if (!isRecord(rawColors)) throw new Error("Theme files need a colors object.");

  const id = value.id === undefined ? themeIdFromName(name) : value.id;
  if (!isThemeId(id)) {
    throw new Error("Theme ids may only contain lowercase letters, numbers, and hyphens.");
  }
  if (RESERVED_THEME_IDS.has(id)) {
    throw new Error(`The theme id "${id}" is reserved.`);
  }

  const overrides = parseThemeColorOverrides(rawColors);
  const collection = parseThemeCollection(value.collection);
  if (value.collection !== undefined && !collection) {
    throw new Error("Theme collections need a valid id and label.");
  }

  const fallback = getDefaultThemeColors(appearance);
  const variants: Partial<Record<ThemeAppearance, ThemeColors>> = {};
  if (value.variants !== undefined) {
    if (!isRecord(value.variants)) throw new Error("Theme variants must be an object.");
    for (const [variantAppearance, variantColors] of Object.entries(value.variants)) {
      if (!isThemeAppearance(variantAppearance)) {
        throw new Error('Theme variants may only be named "light" or "dark".');
      }
      if (variantAppearance === appearance) {
        throw new Error(`Theme variants must not repeat the base appearance "${appearance}".`);
      }
      const variantFallback = getDefaultThemeColors(variantAppearance);
      variants[variantAppearance] = {
        ...variantFallback,
        ...parseThemeColorOverrides(variantColors),
      };
    }
  }

  return {
    id,
    label: name.trim(),
    appearance,
    colors: { ...fallback, ...overrides },
    ...(Object.keys(variants).length > 0 ? { variants } : {}),
    ...(collection ? { collection } : {}),
    ...(value.managed === true ? { managed: true } : {}),
  };
}

export function serializeThemeFile(theme: ThemeDefinition): string {
  const canonicalTheme = canonicalizeThemeDefinition(theme);
  const file: ThemeFile = {
    version: THEME_FILE_VERSION,
    id: canonicalTheme.id,
    name: canonicalTheme.label,
    appearance: canonicalTheme.appearance,
    colors: canonicalTheme.colors,
    ...(canonicalTheme.variants ? { variants: canonicalTheme.variants } : {}),
    ...(canonicalTheme.collection ? { collection: canonicalTheme.collection } : {}),
    ...(canonicalTheme.managed ? { managed: true } : {}),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

const APP_THEME_VARIABLES: Readonly<Record<ThemeColorRole, string>> = {
  canvas: "--app-theme-canvas",
  chrome: "--app-theme-chrome",
  toolbar: "--app-theme-toolbar",
  toolbarForeground: "--app-theme-toolbar-foreground",
  toolbarBorder: "--app-theme-toolbar-border",
  toolbarControl: "--app-theme-toolbar-control",
  toolbarControlForeground: "--app-theme-toolbar-control-foreground",
  toolbarControlHover: "--app-theme-toolbar-control-hover",
  surface: "--app-theme-surface",
  surfaceRaised: "--app-theme-surface-raised",
  surfaceOverlay: "--app-theme-surface-overlay",
  text: "--app-theme-text",
  textMuted: "--app-theme-text-muted",
  border: "--app-theme-border",
  input: "--app-theme-input",
  focus: "--app-theme-focus",
  accent: "--app-theme-accent",
  accentForeground: "--app-theme-accent-foreground",
  secondary: "--app-theme-secondary",
  secondaryForeground: "--app-theme-secondary-foreground",
  muted: "--app-theme-muted",
  mutedForeground: "--app-theme-muted-foreground",
  placeholder: "--app-theme-placeholder",
  secondaryLabel: "--app-theme-secondary-label",
  iconMuted: "--app-theme-icon-muted",
  error: "--app-theme-error",
  errorForeground: "--app-theme-error-foreground",
  errorSurface: "--app-theme-error-surface",
  warning: "--app-theme-warning",
  warningForeground: "--app-theme-warning-foreground",
  warningSurface: "--app-theme-warning-surface",
  update: "--app-theme-update",
  updateForeground: "--app-theme-update-foreground",
  updateSurface: "--app-theme-update-surface",
  accentSurface: "--app-theme-accent-surface",
  accentSurfaceForeground: "--app-theme-accent-surface-foreground",
  messageSurface: "--app-theme-message-surface",
  messageForeground: "--app-theme-message-foreground",
  messageAction: "--app-theme-message-action",
  messageActionForeground: "--app-theme-message-action-foreground",
  messageActionHover: "--app-theme-message-action-hover",
  codeBackground: "--app-theme-code-background",
  codeForeground: "--app-theme-code-foreground",
  searchMatchBackground: "--app-theme-search-match-background",
  searchMatchForeground: "--app-theme-search-match-foreground",
  searchMatchActiveBackground: "--app-theme-search-match-active-background",
  searchMatchActiveForeground: "--app-theme-search-match-active-foreground",
  sidebar: "--app-theme-sidebar",
  sidebarForeground: "--app-theme-sidebar-foreground",
  sidebarMutedForeground: "--app-theme-sidebar-muted-foreground",
  sidebarControlSurface: "--app-theme-sidebar-control-surface",
  sidebarRowHover: "--app-theme-sidebar-row-hover",
  sidebarRowActive: "--app-theme-sidebar-row-active",
  sidebarRowSelected: "--app-theme-sidebar-row-selected",
  sidebarBorder: "--app-theme-sidebar-border",
  terminalBackground: "--app-theme-terminal-background",
  terminalForeground: "--app-theme-terminal-foreground",
  terminalCursor: "--app-theme-terminal-cursor",
  terminalSelection: "--app-theme-terminal-selection-background",
  terminalScrollbar: "--app-theme-terminal-scrollbar",
  terminalScrollbarHover: "--app-theme-terminal-scrollbar-hover",
};

const THEME_PREVIEW_ID = "__preview";

/** Callers must restore the stored theme with refreshTheme when the draft closes. */
export function applyThemeColorPreview(colors: ThemeColors, appearance: ThemeAppearance): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root?.style) return;

  root.dataset.themeId = THEME_PREVIEW_ID;
  root.classList.toggle("dark", appearance === "dark");
  for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
    if (isThemeColor(value)) root.style.setProperty(APP_THEME_VARIABLES[role], value);
  }
  setThemePreviewAppearance(appearance);
}

export function applyThemePalette(theme: ThemePreference, appearance?: ThemeAppearance): void {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  if (!root?.style) return;

  setThemePreviewAppearance(null);
  const palette = getThemeDefinition(theme);

  if (palette) {
    root.dataset.themeId = palette.id;
    const mode = appearance ?? legacyThemeMode(theme) ?? palette.appearance;
    const colors = getThemeColorsForMode(palette, mode) ?? palette.colors;
    for (const [role, value] of Object.entries(colors) as Array<[ThemeColorRole, string]>) {
      root.style.setProperty(APP_THEME_VARIABLES[role], value);
    }
    return;
  }

  delete root.dataset.themeId;
  for (const variable of Object.values(APP_THEME_VARIABLES)) {
    root.style.removeProperty(variable);
  }
}

export type ThemeHalves = Readonly<{ light?: string; dark?: string }>;
