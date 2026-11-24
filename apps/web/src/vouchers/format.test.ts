import { expect, it } from "vite-plus/test";
import {
  formatBytes,
  formatDuration,
  formatRouterTime,
  formatSpan,
  formatVoucherValue,
} from "./format";

it("localizes RouterOS durations, usage units and wall-clock dates without changing identifiers", () => {
  expect(formatVoucherValue("1h10m", "uptime", "ar")).toBe("١ س ١٠ د");
  expect(formatVoucherValue("2048", "download", "ar")).toBe("٢ كيبيبايت");
  expect(formatVoucherValue("never", "lastSeen", "ar")).toBe("لم يُستخدم بعد");
  expect(formatVoucherValue("nov/14/2026 12:34:56", "started", "ar")).not.toContain("nov");
  expect(formatVoucherValue("my-plan", "profile", "ar")).toBe("my-plan");
  expect(formatVoucherValue(undefined, "uptime", "ar")).toBe("–");
});

it("formats typed usage and router-local times without shifting the PC time zone", () => {
  expect(formatBytes(2147483648, "en")).toBe("2 GiB");
  expect(formatBytes(1536, "en")).toBe("1.5 KiB");
  expect(formatBytes(null, "en")).toBe("–");
  expect(formatDuration(93784, "en")).toBe("1 days 2 hours 3 minutes 4 seconds");
  expect(formatDuration(0, "ar")).toBe("٠ ث");
  expect(formatSpan(3 * 86400 + 5, "en")).toBe("3 days");
  expect(formatSpan(3600, "en")).toBe("1 hour");
  expect(formatSpan(30, "en")).toBe("less than a minute");
  expect(formatRouterTime("2026-11-24 23:30:00", "en")).toContain("Nov 24, 2026");
  expect(formatRouterTime(null, "en")).toBe("–");
});
