import { expect, it } from "@effect/vitest";
import {
  formatRouterDateTime,
  naturalKey,
  parseBytes,
  parseDuration,
  parseRouterDateTime,
  parseSharedUsers,
  parseWeekdays,
} from "./routerValues.ts";

it("reads User Manager byte counters with or without the API's B suffix", () => {
  expect(parseBytes("2147483648")).toBe(2147483648);
  expect(parseBytes("2147483648B")).toBe(2147483648);
  expect(parseBytes("0B")).toBe(0);
  expect(parseBytes("")).toBeNull();
  expect(parseBytes("2GiB")).toBeNull();
});

it("reads RouterOS durations in unit and clock form", () => {
  expect(parseDuration("1w2d3h4m5s")).toBe(604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  expect(parseDuration("0s")).toBe(0);
  expect(parseDuration("10m")).toBe(600);
  expect(parseDuration("23h59m59s")).toBe(86399);
  expect(parseDuration("1d02:03:04")).toBe(86400 + 2 * 3600 + 3 * 60 + 4);
  expect(parseDuration("")).toBeNull();
  expect(parseDuration("soon")).toBeNull();
});

it("keeps router dates as naive router-local values and rejects invalid ones", () => {
  expect(parseRouterDateTime("mar/19/2018 21:48:15")).toBe("2018-03-19 21:48:15");
  expect(parseRouterDateTime("nov/24/2026 08:39:07")).toBe("2026-11-24 08:39:07");
  expect(parseRouterDateTime("never")).toBeNull();
  expect(parseRouterDateTime("foo/19/2018 21:48:15")).toBeNull();
  expect(parseRouterDateTime("mar/19/2018 25:48:15")).toBeNull();
  expect(formatRouterDateTime("2026-11-24 08:39:07")).toBe("nov/24/2026 08:39:07");
});

it("distinguishes unlimited shared users from unreadable values", () => {
  expect(parseSharedUsers("unlimited")).toEqual({ count: null, unlimited: true });
  expect(parseSharedUsers("10")).toEqual({ count: 10, unlimited: false });
  expect(parseSharedUsers("off")).toEqual({ count: null, unlimited: false });
});

it("reads profile-limitation weekdays as a mask", () => {
  expect(parseWeekdays("sunday,monday,tuesday,wednesday,thursday,friday,saturday")).toBe(127);
  expect(parseWeekdays("monday")).toBe(2);
  expect(parseWeekdays("someday")).toBeNull();
});

it("orders usernames naturally under binary comparison", () => {
  const names = ["v-10", "v-2", "V-1", "v-002a", "a", "v-2b", "v-100"];
  expect([...names].sort((a, b) => (naturalKey(a) < naturalKey(b) ? -1 : 1))).toEqual([
    "a",
    "V-1",
    "v-2",
    "v-002a",
    "v-2b",
    "v-10",
    "v-100",
  ]);
});
