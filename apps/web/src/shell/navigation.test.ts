import { describe, expect, it } from "vite-plus/test";
import {
  changeNavigation,
  decodeNavigation,
  defaultNavigation,
  saveNavigation,
} from "./navigation";

describe("Madar navigation", () => {
  it("persists ordering, pins, groups and collapse state together", () => {
    let state = changeNavigation(defaultNavigation, {
      type: "add-group",
      id: "daily",
      name: "Daily",
    });
    state = changeNavigation(state, { type: "assign", id: "usage", group: "daily" });
    state = changeNavigation(state, { type: "collapse-group", id: "daily" });
    state = changeNavigation(state, { type: "pin", id: "vouchers" });
    state = changeNavigation(state, { type: "move", id: "subscriptions", before: "overview" });
    const storage = new Map<string, string>();
    saveNavigation(
      {
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
      state,
    );
    expect(decodeNavigation([...storage.values()][0]!)).toEqual(state);
    expect(state.items[0]?.id).toBe("subscriptions");
    expect(state.items.find((item) => item.id === "usage")?.group).toBe("daily");
    expect(state.items.find((item) => item.id === "vouchers")?.pinned).toBe(true);
    expect(state.groups[0]?.collapsed).toBe(true);
  });

  it("moves across groups and removing a group retains its destinations", () => {
    let state = changeNavigation(defaultNavigation, {
      type: "add-group",
      id: "daily",
      name: "Daily",
    });
    state = changeNavigation(state, { type: "assign", id: "usage", group: "daily" });
    state = changeNavigation(state, { type: "move", id: "vouchers", before: "usage" });
    expect(state.items.find((item) => item.id === "vouchers")?.group).toBe("daily");
    state = changeNavigation(state, { type: "rename-group", id: "daily", name: "Morning" });
    expect(state.groups[0]?.name).toBe("Morning");
    state = changeNavigation(state, { type: "remove-group", id: "daily" });
    expect(state.groups).toEqual([]);
    expect(state.items).toHaveLength(defaultNavigation.items.length);
    expect(state.items.every((item) => item.group === "")).toBe(true);
  });

  it("unpins and rejects missing destinations and malformed storage", () => {
    let state = changeNavigation(defaultNavigation, { type: "pin", id: "usage" });
    state = changeNavigation(state, { type: "pin", id: "usage" });
    expect(state).toEqual(defaultNavigation);
    expect(() =>
      decodeNavigation(JSON.stringify({ ...state, items: state.items.slice(1) })),
    ).toThrow();
    expect(() => decodeNavigation("broken")).toThrow();
  });

  it("reports persistence failures so callers can retain the last saved state", () => {
    expect(() =>
      saveNavigation(
        {
          setItem() {
            throw new Error("Storage full");
          },
        },
        defaultNavigation,
      ),
    ).toThrow("Storage full");
  });
});
it("moves the requested destination down without moving its neighbor into another group", () => {
  let state = changeNavigation(defaultNavigation, {
    type: "add-group",
    id: "daily",
    name: "Daily",
  });
  state = changeNavigation(state, { type: "assign", id: "overview", group: "daily" });
  state = changeNavigation(state, {
    type: "move",
    id: "overview",
    before: "vouchers",
    after: true,
    keepMembership: true,
  });
  expect(state.items.slice(0, 2).map((item) => item.id)).toEqual(["vouchers", "overview"]);
  expect(state.items.find((item) => item.id === "vouchers")?.group).toBe("");
  expect(state.items.find((item) => item.id === "overview")?.group).toBe("daily");
});
