import { expect, it } from "vite-plus/test";
import { formatVoucherValue } from "./format";

it("localizes RouterOS durations, usage units and wall-clock dates without changing identifiers", () => {
  expect(formatVoucherValue("1h10m", "uptime", "ar")).toBe("١ س ١٠ د");
  expect(formatVoucherValue("2048", "download", "ar")).toBe("٢ كيبيبايت");
  expect(formatVoucherValue("never", "lastSeen", "ar")).toBe("لم يُستخدم بعد");
  expect(formatVoucherValue("nov/14/2026 12:34:56", "started", "ar")).not.toContain("nov");
  expect(formatVoucherValue("my-plan", "profile", "ar")).toBe("my-plan");
  expect(formatVoucherValue(undefined, "uptime", "ar")).toBe("–");
});
