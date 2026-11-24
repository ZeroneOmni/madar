import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { VoucherFieldFilter, VoucherQuery, VoucherScope } from "@madar/contracts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as VoucherFieldStore from "./VoucherFieldStore.ts";
import * as VoucherStore from "./VoucherStore.ts";

const scope: VoucherScope = {
  router: {
    id: "fields",
    name: "Fields",
    host: "127.0.0.1",
    port: 8728,
    transport: "tcp",
    username: "admin",
    color: "blue",
    icon: "router",
    label: "",
  },
  customer: "admin",
};
const voucher = (id: string, username: string): VoucherStore.RouterVoucher => ({
  id,
  customer: "admin",
  username,
  comment: "",
  disabled: false,
  active: false,
  incomplete: false,
  profile: "",
  sharedUsers: 1,
  download: 0,
  upload: 0,
  uptime: 0,
  lastSeen: "never",
  activeSessions: 0,
  registrationDate: null,
  callerId: "",
  callerIdBind: false,
  ipAddress: "",
  ipv6Dns: "",
  ipv6Prefix: "",
  wirelessEncryption: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  location: "",
  observedAt: "t1",
});
const query = (overrides: Partial<VoucherQuery> = {}): VoucherQuery => ({
  ...scope,
  search: "",
  status: "all",
  profile: "",
  sort: { field: "username", direction: "asc" },
  offset: 0,
  limit: 50,
  ...overrides,
});
const layer = Layer.mergeAll(VoucherStore.layer, VoucherFieldStore.layer).pipe(
  Layer.provideMerge(Sqlite.layerMemory),
);
const setup = Effect.gen(function* () {
  const store = yield* VoucherStore.VoucherStore;
  const fields = yield* VoucherFieldStore.VoucherFieldStore;
  yield* store.replace(
    scope,
    [voucher("*1", "v-1"), voucher("*2", "v-2"), voucher("*3", "v-3"), voucher("*4", "v-10")],
    "t1",
  );
  yield* fields.save({ name: "Shop", type: "text", choices: [] });
  yield* fields.save({ name: "Paid", type: "number", choices: [] });
  yield* fields.save({ name: "Sold on", type: "date", choices: [] });
  yield* fields.save({ name: "Printed", type: "boolean", choices: [] });
  const all = yield* fields.save({
    name: "Area",
    type: "choice",
    choices: [{ label: "North" }, { label: "South" }],
  });
  const [shop, paid, sold, printed, area] = all;
  const names = (overrides: Partial<VoucherQuery>) =>
    store.list(query(overrides)).pipe(Effect.map((page) => page.items.map((row) => row.username)));
  return {
    store,
    fields,
    shop: shop!,
    paid: paid!,
    sold: sold!,
    printed: printed!,
    area: area!,
    names,
  };
});

it.effect("saves one typed value per field and rejects values of the wrong type", () =>
  Effect.gen(function* () {
    const { store, fields, shop, paid, sold, printed, area } = yield* setup;
    const sql = yield* SqlClient.SqlClient;
    const north = area.choices[0]!.id;
    expect(
      yield* fields.setValues({
        ...scope,
        ids: ["*1", "*2", "*missing"],
        values: [
          { fieldId: shop.id, value: "Al Amin" },
          { fieldId: paid.id, value: 2.5 },
          { fieldId: sold.id, value: "2026-11-24" },
          { fieldId: printed.id, value: true },
          { fieldId: area.id, value: north },
        ],
      }),
    ).toEqual({ updated: 2 });
    const row = (yield* store.list(query({ search: "v-1" }))).items.find(
      (item) => item.id === "*1",
    );
    expect(row?.fields).toEqual({
      [shop.id]: "Al Amin",
      [paid.id]: 2.5,
      [sold.id]: "2026-11-24",
      [printed.id]: true,
      [area.id]: north,
    });
    for (const [fieldId, value] of [
      [paid.id, "2.5"],
      [sold.id, "2026-02-30"],
      [printed.id, 1],
      [area.id, 999],
      [shop.id, "   "],
    ] as const) {
      const exit = yield* Effect.exit(
        fields.setValues({ ...scope, ids: ["*3"], values: [{ fieldId, value }] }),
      );
      expect(exit._tag, `${fieldId}=${value}`).toBe("Failure");
    }
    // The database refuses a mismatched column even when the service is bypassed.
    const direct = yield* Effect.exit(
      sql`INSERT INTO voucher_field_values (field_id, router_key, customer, username, router_id, text_value)
        VALUES (${paid.id}, 'r', 'admin', 'v-3', '*3', 'text in a number field')`,
    );
    expect(direct._tag).toBe("Failure");
    yield* fields.setValues({ ...scope, ids: ["*1"], values: [{ fieldId: shop.id, value: null }] });
    expect((yield* fields.list()).find((field) => field.id === shop.id)?.valueCount).toBe(1);
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps choices in their own table and drops values of a removed choice", () =>
  Effect.gen(function* () {
    const { fields, area } = yield* setup;
    const [north, south] = area.choices;
    yield* fields.setValues({
      ...scope,
      ids: ["*1"],
      values: [{ fieldId: area.id, value: north!.id }],
    });
    yield* fields.setValues({
      ...scope,
      ids: ["*2"],
      values: [{ fieldId: area.id, value: south!.id }],
    });
    // Swapping labels keeps the ids, so saved values keep their meaning.
    const swapped = yield* fields.save({
      id: area.id,
      name: "Region",
      type: "choice",
      choices: [
        { id: south!.id, label: "North" },
        { id: north!.id, label: "South" },
      ],
    });
    expect(swapped.find((field) => field.id === area.id)).toMatchObject({
      name: "Region",
      choices: [
        { id: south!.id, label: "North" },
        { id: north!.id, label: "South" },
      ],
      valueCount: 2,
    });
    const trimmed = yield* fields.save({
      id: area.id,
      name: "Region",
      type: "choice",
      choices: [{ id: north!.id, label: "South" }, { label: "East" }],
    });
    expect(trimmed.find((field) => field.id === area.id)).toMatchObject({
      choices: [{ id: north!.id, label: "South" }, { label: "East" }],
      valueCount: 1,
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("refuses duplicate names and type changes, and deletes a field with its values", () =>
  Effect.gen(function* () {
    const { fields, shop, paid } = yield* setup;
    expect(
      (yield* Effect.flip(fields.save({ name: "shop", type: "text", choices: [] }))).reason,
    ).toBe("conflict");
    expect(
      (yield* Effect.flip(fields.save({ id: paid.id, name: "Paid", type: "text", choices: [] })))
        .reason,
    ).toBe("rejected");
    expect(
      (yield* Effect.flip(fields.save({ name: "Empty choice", type: "choice", choices: [] })))
        .reason,
    ).toBe("rejected");
    yield* fields.setValues({
      ...scope,
      ids: ["*1", "*2"],
      values: [{ fieldId: shop.id, value: "x" }],
    });
    expect((yield* fields.list()).find((field) => field.id === shop.id)?.valueCount).toBe(2);
    const reordered = yield* fields.reorder([paid.id, shop.id]);
    expect(reordered.slice(0, 2).map((field) => field.name)).toEqual(["Paid", "Shop"]);
    // A stale count is refused, so values added after the confirmation are not lost silently.
    expect((yield* Effect.flip(fields.remove(shop.id, 1))).reason).toBe("conflict");
    expect((yield* fields.list()).some((field) => field.id === shop.id)).toBe(true);
    const remaining = yield* fields.remove(shop.id, 2);
    expect(remaining.map((field) => field.name)).not.toContain("Shop");
    const sql = yield* SqlClient.SqlClient;
    expect(yield* sql`SELECT * FROM voucher_field_values WHERE field_id = ${shop.id}`).toEqual([]);
  }).pipe(Effect.provide(layer)),
);

it.effect("sorts and filters by a local field by its type, with empty values last", () =>
  Effect.gen(function* () {
    const { fields, shop, paid, sold, printed, area, names } = yield* setup;
    const [north, south] = area.choices;
    const set = (id: string, fieldId: number, value: string | number | boolean) =>
      fields.setValues({ ...scope, ids: [id], values: [{ fieldId, value }] });
    yield* set("*1", paid.id, 30);
    yield* set("*2", paid.id, 5);
    yield* set("*4", paid.id, 12);
    yield* set("*1", shop.id, "North Market");
    yield* set("*3", shop.id, "south kiosk");
    yield* set("*2", sold.id, "2026-11-01");
    yield* set("*3", sold.id, "2026-11-20");
    yield* set("*4", printed.id, true);
    yield* set("*1", printed.id, false);
    yield* set("*3", area.id, south!.id);
    yield* set("*4", area.id, north!.id);
    const sort = (fieldId: number, direction: "asc" | "desc") =>
      names({ sort: { field: "custom", fieldId, direction } });
    expect(yield* sort(paid.id, "asc")).toEqual(["v-2", "v-10", "v-1", "v-3"]);
    expect(yield* sort(paid.id, "desc")).toEqual(["v-1", "v-10", "v-2", "v-3"]);
    expect(yield* sort(shop.id, "asc")).toEqual(["v-1", "v-3", "v-2", "v-10"]);
    // Choices sort by their order in the field, not alphabetically.
    expect(yield* sort(area.id, "asc")).toEqual(["v-10", "v-3", "v-1", "v-2"]);
    const filter = (fieldFilter: VoucherFieldFilter) => names({ fieldFilter });
    expect(yield* filter({ fieldId: paid.id, op: "range", min: 10, max: null })).toEqual([
      "v-1",
      "v-10",
    ]);
    expect(yield* filter({ fieldId: shop.id, op: "contains", text: "SOUTH" })).toEqual(["v-3"]);
    expect(yield* filter({ fieldId: shop.id, op: "empty" })).toEqual(["v-2", "v-10"]);
    expect(yield* filter({ fieldId: sold.id, op: "dates", from: "2026-11-10", to: null })).toEqual([
      "v-3",
    ]);
    expect(yield* filter({ fieldId: printed.id, op: "flag", value: false })).toEqual(["v-1"]);
    expect(yield* filter({ fieldId: area.id, op: "choice", choiceId: north!.id })).toEqual([
      "v-10",
    ]);
    expect(yield* filter({ fieldId: area.id, op: "filled" })).toEqual(["v-3", "v-10"]);
    // A filter on a local field combines with a remaining-based status.
    expect(
      yield* names({ status: "unknown", fieldFilter: { fieldId: paid.id, op: "filled" } }),
    ).toEqual([]);
  }).pipe(Effect.provide(layer)),
);

it.effect("moves values with a renamed voucher and never gives them to a reused username", () =>
  Effect.gen(function* () {
    const { store, fields, shop } = yield* setup;
    yield* fields.setValues({
      ...scope,
      ids: ["*1", "*2"],
      values: [{ fieldId: shop.id, value: "kept" }],
    });
    yield* store.replace(
      scope,
      [{ ...voucher("*1", "renamed") }, voucher("*3", "v-3"), voucher("*4", "v-10")],
      "t2",
    );
    const page = yield* store.list(query());
    expect(page.items.find((row) => row.id === "*1")?.fields).toEqual({ [shop.id]: "kept" });
    yield* store.replace(
      scope,
      [voucher("*1", "renamed"), voucher("*3", "v-3"), voucher("*4", "v-10"), voucher("*9", "v-2")],
      "t3",
    );
    const reused = (yield* store.list(query({ search: "v-2" }))).items[0];
    expect(reused).toMatchObject({ id: "*9", fields: {} });
    expect((yield* fields.list()).find((field) => field.id === shop.id)?.valueCount).toBe(1);
  }).pipe(Effect.provide(layer)),
);

it.effect("never reuses the id of a deleted field or choice", () =>
  Effect.gen(function* () {
    const { fields, area } = yield* setup;
    const [, south] = area.choices;
    yield* fields.save({
      id: area.id,
      name: area.name,
      type: "choice",
      choices: [{ id: area.choices[0]!.id, label: "North" }],
    });
    const afterChoice = yield* fields.save({
      id: area.id,
      name: area.name,
      type: "choice",
      choices: [{ id: area.choices[0]!.id, label: "North" }, { label: "West" }],
    });
    const west = afterChoice.find((field) => field.id === area.id)!.choices[1]!;
    expect(west.id).not.toBe(south!.id);
    yield* fields.remove(area.id, 0);
    const created = yield* fields.save({ name: "Replacement", type: "text", choices: [] });
    expect(created.find((field) => field.name === "Replacement")!.id).not.toBe(area.id);
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps every voucher's values through a username swap and a rename chain", () =>
  Effect.gen(function* () {
    const { store, fields, shop } = yield* setup;
    yield* fields.setValues({
      ...scope,
      ids: ["*1"],
      values: [{ fieldId: shop.id, value: "one" }],
    });
    yield* fields.setValues({
      ...scope,
      ids: ["*2"],
      values: [{ fieldId: shop.id, value: "two" }],
    });
    yield* fields.setValues({
      ...scope,
      ids: ["*3"],
      values: [{ fieldId: shop.id, value: "three" }],
    });
    // Swap *1 and *2, and chain *3 (v-3) into the name *4 (v-10) leaves for v-11.
    yield* store.replace(
      scope,
      [voucher("*1", "v-2"), voucher("*2", "v-1"), voucher("*3", "v-10"), voucher("*4", "v-11")],
      "t2",
    );
    const values = new Map(
      (yield* store.list(query())).items.map((row) => [row.id, row.fields[String(shop.id)]]),
    );
    expect(Object.fromEntries(values)).toEqual({
      "*1": "one",
      "*2": "two",
      "*3": "three",
      "*4": undefined,
    });
  }).pipe(Effect.provide(layer)),
);
