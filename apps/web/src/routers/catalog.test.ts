import { expect, it } from "vite-plus/test";
import { CATALOG_KEY, decodeCatalog, emptyCatalog, saveCatalog } from "./catalog";

it("starts with no router and round-trips the saved catalog", () => {
  expect(decodeCatalog(null)).toEqual(emptyCatalog);
  const setItem = (key: string, value: string) => {
    expect(key).toBe(CATALOG_KEY);
    expect(decodeCatalog(value)).toEqual(emptyCatalog);
  };
  saveCatalog({ setItem }, emptyCatalog);
});
it("rejects an invalid selected router instead of silently using another router", () => {
  expect(() => decodeCatalog(JSON.stringify({ routers: [], selected: "missing" }))).toThrow();
});
it("propagates failed saves so the caller can preserve the current catalog", () => {
  expect(() =>
    saveCatalog(
      {
        setItem: () => {
          throw new Error("Full");
        },
      },
      emptyCatalog,
    ),
  ).toThrow("Full");
});
