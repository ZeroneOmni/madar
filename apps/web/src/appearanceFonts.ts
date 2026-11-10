export const DEFAULT_SANS_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

// Some engines map `ui-monospace` to a proportional font, so prefer concrete names.
export const DEFAULT_CODE_FONT_STACK =
  '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace';

function quoteFontFamilyName(name: string): string {
  const bare = name.trim();
  if (bare.length === 0) return "";
  if (/^(['"]).*\1$/.test(bare)) return bare;
  if (/^[a-zA-Z][a-zA-Z0-9-]*$/.test(bare)) return bare;
  return `"${bare.replaceAll('"', "")}"`;
}

function cssFontFamilies(input: string): string | null {
  const families = input
    .split(",")
    .map(quoteFontFamilyName)
    .filter((name) => name.length > 0);
  return families.length > 0 ? families.join(", ") : null;
}

export function appearanceFontStack(custom: string, defaultStack: string): string {
  const families = cssFontFamilies(custom);
  return families === null ? defaultStack : `${families}, ${defaultStack}`;
}

const FONT_PROBE_TEXT = "mmmmmmmmMMWli1O0@# fjord";
let fontProbeContext: CanvasRenderingContext2D | null | undefined;

function probeWidth(fontList: string): number | null {
  if (fontProbeContext === undefined) {
    fontProbeContext = document.createElement("canvas").getContext("2d");
  }
  if (fontProbeContext === null) return null;
  fontProbeContext.font = `16px ${fontList}`;
  return fontProbeContext.measureText(FONT_PROBE_TEXT).width;
}

/** Probes canvas metrics because document.fonts.check() accepts uninstalled families. */
export function isFontFamilyAvailable(family: string): boolean {
  const families = cssFontFamilies(family);
  if (families === null) return false;
  if (/^(system-ui|sans-serif|serif|monospace|ui-monospace)$/i.test(families)) return true;
  try {
    for (const generic of ["monospace", "serif", "sans-serif"]) {
      const baseline = probeWidth(generic);
      const candidate = probeWidth(`${families}, ${generic}`);
      if (baseline === null || candidate === null) return false;
      if (candidate !== baseline) return true;
    }
    return false;
  } catch {
    return false;
  }
}

const MONOSPACE_PROBE_VARIANTS = ["normal 400", "normal 700", "italic 400", "italic 700"] as const;
const MONOSPACE_PROBE_GLYPHS = ["i", "M", "W", "0", "@", "#", ".", " "] as const;
const MONOSPACE_ADVANCE_TOLERANCE = 0.01;

function areFontAdvancesMonospace(advances: readonly number[]): boolean {
  const reference = advances[0];
  if (
    reference === undefined ||
    reference <= 0 ||
    advances.some((advance) => !Number.isFinite(advance) || advance <= 0)
  ) {
    return true;
  }
  return advances.every((advance) => Math.abs(advance - reference) < MONOSPACE_ADVANCE_TOLERANCE);
}

export function isMonospaceFamily(family: string): boolean {
  const families = cssFontFamilies(family);
  if (families === null) return true;
  try {
    if (fontProbeContext === undefined) {
      fontProbeContext = document.createElement("canvas").getContext("2d");
    }
    if (fontProbeContext === null) return true;
    const context = fontProbeContext;
    for (const variant of MONOSPACE_PROBE_VARIANTS) {
      context.font = `${variant} 32px ${families}, monospace`;
      const advances = MONOSPACE_PROBE_GLYPHS.map((glyph) => context.measureText(glyph).width);
      if (!areFontAdvancesMonospace(advances)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

export interface InstalledFontFamiliesResult {
  readonly families: readonly string[];
  readonly status: "granted" | "denied" | "unsupported";
}

let installedFamiliesCache: InstalledFontFamiliesResult | null = null;

/** Call from a user gesture; the first call prompts for local-fonts permission. */
export async function queryInstalledFontFamilies(): Promise<InstalledFontFamiliesResult> {
  if (installedFamiliesCache !== null) return installedFamiliesCache;
  const query =
    "queryLocalFonts" in window && typeof window.queryLocalFonts === "function"
      ? (window.queryLocalFonts as () => Promise<ReadonlyArray<{ readonly family: string }>>)
      : undefined;
  if (typeof query !== "function") {
    installedFamiliesCache = { families: [], status: "unsupported" };
    return installedFamiliesCache;
  }
  try {
    const fonts = await query.call(window);
    const families = [...new Set(fonts.map((font) => font.family))]
      // Dot-prefixed macOS UI faces often refuse to render in web content.
      .filter((family) => !family.startsWith("."))
      .sort((left, right) => left.localeCompare(right));
    // Denied access can return an empty list instead of throwing.
    if (families.length === 0) return { families: [], status: "denied" };
    installedFamiliesCache = { families, status: "granted" };
    return installedFamiliesCache;
  } catch {
    return { families: [], status: "denied" };
  }
}
