import { expect, it } from "vite-plus/test";
import { formatDateTime, formatNumber, resolveLocale, translate } from "./locale";

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

it("formats counts and timestamps with the digits of the active language", () => {
  expect(formatNumber(1284, "ar")).toBe("١٬٢٨٤");
  expect(formatNumber(1284, "en")).toBe("1,284");
  expect(formatDateTime("2026-11-19T09:42:00Z", "ar")).not.toMatch(/[0-9]/);
  expect(formatDateTime("2026-11-19T09:42:00Z", "en")).toContain("2026");
});
