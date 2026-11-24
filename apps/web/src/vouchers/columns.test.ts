import { expect, it } from "vite-plus/test";
import {
  DEFAULT_SORT,
  moveColumn,
  moveColumnVisually,
  normalizeLayout,
  querySort,
} from "./columns";

it("drops unknown and duplicate saved columns and keeps Username first", () => {
  expect(
    normalizeLayout({
      version: 1,
      columns: ["remaining", "removedField", "username", "remaining", "created"],
      sort: { field: "created", direction: "desc" },
    }),
  ).toEqual({
    columns: ["username", "remaining", "created"],
    sort: { field: "created", direction: "desc" },
  });
  expect(
    normalizeLayout({ version: 1, columns: [], sort: { field: "gone", direction: "desc" } }),
  ).toEqual({ columns: ["username"], sort: DEFAULT_SORT });
});

it("never moves a column before Username", () => {
  const columns = ["username", "state", "profile", "remaining"] as const;
  expect(moveColumn(columns, "remaining", 0)).toEqual([
    "username",
    "remaining",
    "state",
    "profile",
  ]);
  expect(moveColumn(columns, "username", 2)).toBe(columns);
  expect(moveColumn(columns, "state", 1)).toBe(columns);
});

it("moves columns in the direction the operator sees", () => {
  const columns = ["username", "state", "profile"] as const;
  expect(moveColumnVisually(columns, "state", "right", "ltr")).toEqual([
    "username",
    "profile",
    "state",
  ]);
  // In RTL the next column sits to the left.
  expect(moveColumnVisually(columns, "state", "left", "rtl")).toEqual([
    "username",
    "profile",
    "state",
  ]);
  expect(moveColumnVisually(columns, "state", "right", "rtl")).toBe(columns);
});

it("keeps local field columns until fields load, then only for fields that still exist", () => {
  const layout = {
    version: 1 as const,
    columns: ["username", "field:3", "state", "field:9"],
    sort: { field: "field:9", direction: "desc" as const },
  };
  expect(normalizeLayout(layout, null)).toEqual({
    columns: ["username", "field:3", "state", "field:9"],
    sort: { field: "field:9", direction: "desc" },
  });
  expect(normalizeLayout(layout, new Set([3]))).toEqual({
    columns: ["username", "field:3", "state"],
    sort: DEFAULT_SORT,
  });
  expect(querySort({ field: "field:3", direction: "asc" })).toEqual({
    field: "custom",
    fieldId: 3,
    direction: "asc",
  });
  expect(querySort({ field: "remaining", direction: "desc" })).toEqual({
    field: "remaining",
    direction: "desc",
  });
});
