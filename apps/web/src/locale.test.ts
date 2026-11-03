import { expect, it } from "vite-plus/test";
import { resolveLocale, translate } from "./locale";

it("respects explicit language and detects Arabic regional preferences", () => {
  expect(resolveLocale("en", ["ar-KW"])).toBe("en");
  expect(resolveLocale("ar", ["en-US"])).toBe("ar");
  expect(resolveLocale(null, ["ar-KW", "en"])).toBe("ar");
  expect(resolveLocale("invalid", ["fr", "ar-SA"])).toBe("ar");
  expect(resolveLocale(null, ["fr"])).toBe("en");
});

it("translates complete messages with interpolation and preserves external text", () => {
  expect(translate("ar", "Settings")).toBe("الإعدادات");
  expect(translate("en", "Settings")).toBe("Settings");
  expect(translate("ar", "Move {name} up", { name: "Daily" })).toBe("نقل Daily لأعلى");
  expect(translate("ar", "RouterOS: connection refused")).toBe("RouterOS: connection refused");
});
