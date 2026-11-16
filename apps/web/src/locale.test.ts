import { expect, it } from "vite-plus/test";
import { resolveLocale, translate } from "./locale";

it("respects explicit language and otherwise defaults to Arabic", () => {
  expect(resolveLocale("en")).toBe("en");
  expect(resolveLocale("ar")).toBe("ar");
  expect(resolveLocale(null)).toBe("ar");
  expect(resolveLocale("invalid")).toBe("ar");
});

it("translates complete messages with interpolation and preserves external text", () => {
  expect(translate("ar", "Settings")).toBe("الإعدادات");
  expect(translate("en", "Settings")).toBe("Settings");
  expect(translate("ar", "Move {name} up", { name: "Daily" })).toBe("نقل Daily لأعلى");
  expect(translate("ar", "RouterOS: connection refused")).toBe("RouterOS: connection refused");
});
