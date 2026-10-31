// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - Build-time asset generation.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import sharp from "sharp";
import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const root = NodePath.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const variants = [
  {
    source: BRAND_ASSET_PATHS.developmentIconSvg,
    mac: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    windows: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    favicon: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    small: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    medium: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    touch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
  },
  {
    source: BRAND_ASSET_PATHS.nightlyIconSvg,
    mac: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    windows: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    favicon: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    small: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    medium: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    touch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
  },
  {
    source: BRAND_ASSET_PATHS.productionIconSvg,
    mac: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windows: BRAND_ASSET_PATHS.productionWindowsIconIco,
    favicon: BRAND_ASSET_PATHS.productionWebFaviconIco,
    small: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    medium: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    touch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
  },
];
const generated = new Map<string, Buffer>();
for (const variant of variants) {
  const source = await NodeFSP.readFile(NodePath.join(root, variant.source));
  const images = new Map<number, Buffer>();
  for (const size of [...WINDOWS_ICON_SIZES, 180, 1024]) {
    images.set(size, await sharp(source).resize(size, size).png().toBuffer());
  }
  const image = (size: number) => {
    const contents = images.get(size);
    if (!contents) throw new Error(`Missing ${size}px rendition of ${variant.source}`);
    return contents;
  };
  generated.set(variant.mac, image(1024));
  generated.set(variant.universal, image(1024));
  generated.set(variant.small, image(16));
  generated.set(variant.medium, image(32));
  generated.set(variant.touch, image(180));
  generated.set(
    variant.windows,
    encodePngIco(WINDOWS_ICON_SIZES.map((size) => ({ size, contents: image(size) }))),
  );
  generated.set(
    variant.favicon,
    encodePngIco([16, 32, 48].map((size) => ({ size, contents: image(size) }))),
  );
}
for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
  const contents = generated.get(override.sourceRelativePath);
  if (!contents) throw new Error(`Missing generated source ${override.sourceRelativePath}`);
  generated.set(override.targetRelativePath, contents);
}
for (const [relative, contents] of generated) {
  const path = NodePath.join(root, relative);
  if (check) {
    const existing = await NodeFSP.readFile(path);
    if (!contents.equals(existing)) throw new Error(`Stale icon asset: ${relative}`);
  } else {
    await NodeFSP.writeFile(path, contents);
  }
}
console.log(`${check ? "Verified" : "Updated"} ${generated.size} Madar icon assets.`);
