import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@madar/shared/nodeSqliteClient";
import type { VoucherQuery, VoucherScope } from "@madar/contracts";
import LocalAuthentication from "../persistence/Migrations/001_LocalAuthentication.ts";
import Vouchers from "../persistence/Migrations/002_Vouchers.ts";
import VoucherColumns from "../persistence/Migrations/003_VoucherColumns.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { routerKey } from "../routers/RouterApi.ts";
import * as VoucherStore from "./VoucherStore.ts";
import { naiveToEpoch } from "./routerValues.ts";

const GiB = 1024 ** 3;
const scope: VoucherScope = {
  router: {
    id: "store",
    name: "Store",
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
const voucher = (
  id: string,
  username: string,
  overrides: Partial<VoucherStore.RouterVoucher> = {},
): VoucherStore.RouterVoucher => ({
  id,
  customer: "admin",
  username,
  comment: "",
  disabled: false,
  active: false,
  incomplete: false,
  profile: "2GB",
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
  observedAt: "2026-11-24T09:00:00.000Z",
  ...overrides,
});
const profile = (name: string, validity: number, startsAt: string) => ({
  name,
  owner: "admin",
  nameForUsers: "",
  validity,
  startsAt,
  price: 1,
  overrideSharedUsers: null,
});
const limitation = (name: string, transfer: number) => ({
  name,
  owner: "admin",
  transfer,
  download: 0,
  upload: 0,
  uptime: 0,
});
const allDay = (profile: string, limitation: string) => ({
  profile,
  limitation,
  fromTime: 0,
  tillTime: 86399,
  weekdays: 127,
});
// TestClock starts at epoch 0, so the offset alone sets the router's local time.
const routerNow = "2026-11-24 12:00:00";
const catalog: VoucherStore.CatalogInput = {
  customers: ["admin"],
  profiles: [
    profile("2GB", 0, "logon"),
    profile("1GB", 0, "logon"),
    profile("Week", 7 * 86400, "now"),
    profile("Day", 86400, "logon"),
    profile("Open", 0, "logon"),
    profile("Evenings", 0, "logon"),
  ],
  limitations: [limitation("2GB", 2 * GiB), limitation("1GB", GiB), limitation("Evenings", GiB)],
  profileLimitations: [
    allDay("2GB", "2GB"),
    allDay("1GB", "1GB"),
    { ...allDay("Evenings", "Evenings"), fromTime: 18 * 3600 },
  ],
  syncedAt: "2026-11-24T09:00:00.000Z",
  clockOffset: naiveToEpoch(routerNow) / 1000,
};
const layer = VoucherStore.layer.pipe(Layer.provideMerge(Sqlite.layerMemory));
const setup = Effect.gen(function* () {
  const store = yield* VoucherStore.VoucherStore;
  yield* store.saveCatalog(routerKey(scope.router), catalog);
  const find = Effect.fn(function* (username: string) {
    const page = yield* store.list(query({ search: username }));
    return page.items.find((item) => item.username === username)!;
  });
  return { store, find };
});

it.effect("keeps remaining unknown for lifetime counters until a baseline exists", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    yield* store.replace(
      scope,
      [
        voucher("*1", "fresh"),
        voucher("*2", "worn", { download: 5 * GiB, lastSeen: "2026-11-20 10:00:00" }),
      ],
      "t1",
    );
    expect((yield* find("fresh")).remaining).toMatchObject({
      state: "left",
      kind: "transfer",
      amount: 2 * GiB,
      limit: 2 * GiB,
      basis: "new",
    });
    expect((yield* find("worn")).remaining).toMatchObject({ state: "unknown", reason: "baseline" });
    expect(
      (yield* store.list(query({ status: "unknown" }))).items.map((row) => row.username),
    ).toEqual(["worn"]);

    yield* store.replace(
      scope,
      [
        voucher("*1", "fresh", {
          download: 1.5 * GiB,
          upload: 0.5 * GiB,
          lastSeen: "2026-11-24 11:00:00",
        }),
        voucher("*2", "worn", {
          download: 5 * GiB,
          lastSeen: "2026-11-20 10:00:00",
          profile: "1GB",
        }),
      ],
      "t2",
    );
    expect((yield* find("fresh")).remaining).toMatchObject({ state: "used-up", amount: 0 });
    expect((yield* find("worn")).remaining).toMatchObject({
      state: "left",
      amount: GiB,
      basis: "profile-change",
    });

    yield* store.replace(
      scope,
      [
        voucher("*1", "fresh", {
          download: 1.5 * GiB,
          upload: 0.5 * GiB,
          lastSeen: "2026-11-24 11:00:00",
        }),
        voucher("*2", "worn", {
          download: 5.95 * GiB,
          lastSeen: "2026-11-24 11:00:00",
          profile: "1GB",
        }),
      ],
      "t3",
    );
    const worn = (yield* find("worn")).remaining;
    expect(worn).toMatchObject({ state: "left", basis: "profile-change" });
    expect(worn.amount).toBeCloseTo(0.05 * GiB, -3);
    expect(
      (yield* store.list(query({ status: "ended" }))).items.map((row) => row.username),
    ).toEqual(["fresh"]);
    expect((yield* store.list(query({ status: "low" }))).items.map((row) => row.username)).toEqual([
      "worn",
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("uses the counters read after a Madar activation as an exact baseline", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const worn = voucher("*3", "renewed", { download: 7 * GiB, lastSeen: "2026-11-20 10:00:00" });
    yield* store.replace(scope, [worn], "t1");
    yield* store.upsert(scope, worn, "2026-11-24 11:59:00");
    expect((yield* find("renewed")).remaining).toMatchObject({
      state: "left",
      amount: 2 * GiB,
      basis: "activation",
    });
    yield* store.replace(scope, [{ ...worn, upload: GiB }], "t2");
    expect((yield* find("renewed")).remaining).toMatchObject({ amount: GiB, basis: "activation" });
    // A counter reset leaves the old baseline meaningless, so the estimate restarts from zero.
    yield* store.replace(scope, [{ ...worn, download: 0, upload: 100 }], "t3");
    expect((yield* find("renewed")).remaining).toMatchObject({
      amount: 2 * GiB - 100,
      basis: "counter-reset",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("ends validity from activation for starts-at=now and from first login for logon", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const week = voucher("*4", "week", {
      profile: "Week",
      download: GiB,
      lastSeen: "2026-11-21 10:00:00",
    });
    const lapsed = voucher("*5", "lapsed", {
      profile: "Week",
      download: GiB,
      lastSeen: "2026-11-10 10:00:00",
    });
    const day = voucher("*6", "day", { profile: "Day" });
    yield* store.replace(scope, [week, lapsed, day], "t1");
    yield* store.upsert(scope, week, "2026-11-20 12:00:00");
    yield* store.upsert(scope, lapsed, "2026-11-10 12:00:00");
    expect((yield* find("week")).remaining).toMatchObject({
      state: "ends",
      kind: "validity",
      amount: 3 * 86400,
      endsAt: "2026-11-27 12:00:00",
    });
    expect((yield* find("lapsed")).remaining).toMatchObject({ state: "expired", amount: 0 });
    expect((yield* find("day")).remaining).toMatchObject({ state: "not-started", amount: 86400 });

    yield* store.replace(
      scope,
      [week, lapsed, { ...day, download: 100, lastSeen: "2026-11-24 12:30:00" }],
      "t2",
    );
    expect((yield* find("day")).remaining).toMatchObject({
      state: "unknown",
      reason: "first-login",
    });
    const [candidate] = yield* store.firstLoginCandidates(scope, 10);
    expect(candidate).toMatchObject({
      username: "day",
      lastSeen: "2026-11-24 12:30:00",
      sessionsAfter: "2026-11-24 12:00:00",
    });
    yield* store.saveFirstLogin(scope, candidate!, "2026-11-24 06:00:00");
    expect(yield* store.firstLoginCandidates(scope, 10)).toEqual([]);
    const row = yield* find("day");
    expect(row.firstLoginAt).toBe("2026-11-24 06:00:00");
    expect(row.remaining).toMatchObject({ state: "ends", amount: 18 * 3600 });
    expect(
      (yield* store.list(query({ status: "low" }))).items.map((item) => item.username),
    ).toEqual(["day"]);
  }).pipe(Effect.provide(layer)),
);

it.effect("reports unlimited, no profile and time-windowed limits without guessing", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    yield* store.replace(
      scope,
      [
        voucher("*1", "open", { profile: "Open", download: GiB, lastSeen: "2026-11-24 11:00:00" }),
        voucher("*2", "bare", { profile: "" }),
        voucher("*3", "evening", { profile: "Evenings" }),
        voucher("*4", "missing", { profile: "Deleted" }),
      ],
      "t1",
    );
    expect((yield* find("open")).remaining.state).toBe("unlimited");
    expect((yield* find("bare")).remaining.state).toBe("none");
    expect((yield* find("evening")).remaining).toMatchObject({
      state: "unknown",
      reason: "limits",
    });
    expect((yield* find("missing")).remaining).toMatchObject({
      state: "unknown",
      reason: "catalog",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("sorts naturally by default and keeps empty values last in both directions", () =>
  Effect.gen(function* () {
    const { store } = yield* setup;
    yield* store.replace(
      scope,
      [
        voucher("*1", "v-10", { lastSeen: "2026-11-20 10:00:00", download: 10 }),
        voucher("*2", "v-2", { lastSeen: "never" }),
        voucher("*3", "v-1", { lastSeen: "2026-11-21 10:00:00", download: 10 }),
        voucher("*4", "v-3", { lastSeen: null, download: null }),
      ],
      "t1",
    );
    const names = (sort: VoucherQuery["sort"]) =>
      store.list(query({ sort })).pipe(Effect.map((page) => page.items.map((row) => row.username)));
    expect(yield* names({ field: "username", direction: "asc" })).toEqual([
      "v-1",
      "v-2",
      "v-3",
      "v-10",
    ]);
    expect(yield* names({ field: "username", direction: "desc" })).toEqual([
      "v-10",
      "v-3",
      "v-2",
      "v-1",
    ]);
    expect(yield* names({ field: "lastSeen", direction: "asc" })).toEqual([
      "v-10",
      "v-1",
      "v-2",
      "v-3",
    ]);
    expect(yield* names({ field: "lastSeen", direction: "desc" })).toEqual([
      "v-1",
      "v-10",
      "v-2",
      "v-3",
    ]);
    // Equal values fall back to the natural username order.
    expect(yield* names({ field: "download", direction: "desc" })).toEqual([
      "v-1",
      "v-10",
      "v-2",
      "v-3",
    ]);
    expect(yield* names({ field: "remaining", direction: "asc" })).toEqual([
      "v-2",
      "v-1",
      "v-3",
      "v-10",
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("refreshes router columns without overwriting Madar-owned data", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const sql = yield* SqlClient.SqlClient;
    const item = voucher("*1", "kept", { download: GiB, lastSeen: "2026-11-24 10:00:00" });
    yield* store.replace(scope, [item], "2026-11-24T09:00:00.000Z");
    const batch = yield* store.createBatch(scope, {
      requestId: "batch-request-0001",
      createdAt: "2026-11-24T09:00:00.000Z",
      requested: 1,
      profile: "2GB",
      comment: "Shop",
    });
    yield* store.addBatchMember(scope, batch, "kept", "*1");
    yield* store.upsert(scope, item, "2026-11-24 11:00:00");
    yield* store.replace(
      scope,
      [{ ...item, comment: "changed", download: 1.5 * GiB }],
      "2026-11-24T10:00:00.000Z",
    );
    const row = yield* find("kept");
    expect(row).toMatchObject({
      comment: "changed",
      firstSeenAt: "2026-11-24T09:00:00.000Z",
      changedAt: "2026-11-24T10:00:00.000Z",
      batch: { id: batch, requested: 1, created: 1, profile: "2GB", comment: "Shop" },
      remaining: { state: "left", amount: 1.5 * GiB, basis: "activation" },
    });
    yield* store.replace(
      scope,
      [{ ...item, comment: "changed", download: 1.5 * GiB }],
      "2026-11-24T11:00:00.000Z",
    );
    expect((yield* find("kept")).changedAt).toBe("2026-11-24T10:00:00.000Z");
    expect(yield* sql`SELECT source FROM voucher_baselines WHERE username = 'kept'`).toEqual([
      { source: "activation" },
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("never attaches a removed voucher's Madar data to a reused username", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const sql = yield* SqlClient.SqlClient;
    const original = voucher("*1", "reused", { download: GiB, lastSeen: "2026-11-24 10:00:00" });
    const renamed = voucher("*2", "before", { download: GiB, lastSeen: "2026-11-24 10:00:00" });
    yield* store.replace(scope, [original, renamed], "t1");
    const batch = yield* store.createBatch(scope, {
      requestId: "batch-request-0002",
      createdAt: "t1",
      requested: 2,
      profile: "2GB",
      comment: "",
    });
    yield* store.addBatchMember(scope, batch, "reused", "*1");
    yield* store.addBatchMember(scope, batch, "before", "*2");
    yield* store.upsert(scope, original, "2026-11-24 11:00:00");
    yield* store.upsert(scope, renamed, "2026-11-24 11:00:00");

    yield* store.replace(scope, [{ ...renamed, username: "after" }], "t2");
    expect(yield* sql`SELECT username FROM voucher_baselines`).toEqual([{ username: "after" }]);
    expect(yield* find("after")).toMatchObject({
      batch: { id: batch },
      remaining: { basis: "activation" },
    });

    yield* store.replace(
      scope,
      [
        { ...renamed, username: "after" },
        voucher("*9", "reused", { download: 3 * GiB, lastSeen: "2026-11-24 11:30:00" }),
      ],
      "t3",
    );
    expect(yield* find("reused")).toMatchObject({
      firstSeenAt: "t3",
      batch: null,
      remaining: { state: "unknown", reason: "baseline" },
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("backfills the typed cache from the previous JSON rows for offline browsing", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({
        "001_LocalAuthentication": LocalAuthentication,
        "002_Vouchers": Vouchers,
      }),
    });
    const key = routerKey(scope.router);
    const legacy = (id: string, username: string, data: Record<string, unknown>) =>
      sql`INSERT INTO vouchers VALUES (${key}, 'admin', ${id}, ${username}, 'Day', 0, '', ${JSON.stringify(
        {
          id,
          customer: "admin",
          username,
          disabled: false,
          profile: "Day",
          sharedUsers: "1",
          comment: "",
          upload: "",
          download: "",
          uptime: "",
          lastSeen: "",
          activeSessions: "",
          observedAt: "2026-11-20T00:00:00.000Z",
          ...data,
        },
      )})`;
    yield* legacy("*1", "v-10", {
      download: "2048",
      upload: "1024B",
      uptime: "1w2d3h4m5s",
      lastSeen: "mar/19/2018 21:48:15",
      sharedUsers: "unlimited",
      activeSessions: "1",
    });
    yield* legacy("*2", "v-2", { lastSeen: "never", uptime: "garbled" });
    yield* sql`INSERT INTO voucher_catalog VALUES (${key}, ${JSON.stringify({
      customers: ["admin"],
      profiles: [{ name: "Day", owner: "admin", validity: "1d", startsAt: "logon", price: "1" }],
      syncedAt: "2026-11-20T00:00:00.000Z",
    })}, '2026-11-20T00:00:00.000Z')`;
    yield* sql`INSERT INTO voucher_sync VALUES (${key}, 'admin', '2026-11-20T00:00:00.000Z')`;
    yield* Migrator.make({})({
      loader: Migrator.fromRecord({
        "001_LocalAuthentication": LocalAuthentication,
        "002_Vouchers": Vouchers,
        "003_VoucherColumns": VoucherColumns,
      }),
    });
    const store = yield* VoucherStore.VoucherStore;
    const page = yield* store.list(query());
    expect(page.complete).toBe(true);
    expect(page.items.map((row) => row.username)).toEqual(["v-2", "v-10"]);
    expect(page.items[1]).toMatchObject({
      download: 2048,
      upload: 1024,
      uptime: 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5,
      lastSeen: "2018-03-19 21:48:15",
      sharedUsers: "unlimited",
      activeSessions: 1,
      firstSeenAt: "2026-11-20T00:00:00.000Z",
      remaining: { state: "unknown", reason: "catalog" },
    });
    expect(page.items[0]).toMatchObject({ lastSeen: "never", uptime: null });
    expect(yield* store.catalog(key)).toMatchObject({
      customers: ["admin"],
      profiles: [{ name: "Day", validity: 86400, startsAt: "logon", price: 1 }],
    });
  }).pipe(
    Effect.provide(
      VoucherStore.layer.pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" }))),
    ),
  ),
);

it.effect("serves the first click on each default column from an index", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const field of [
      "username",
      "state",
      "profile",
      "dataUsed",
      "uptime",
      "lastSeen",
    ] as const) {
      const plan = yield* sql.unsafe<{ detail: string }>(
        `EXPLAIN QUERY PLAN SELECT id FROM voucher_cache WHERE router_key = ? AND customer = ? AND 1
          ORDER BY ${VoucherStore.orderBy({ field, direction: "asc" })} LIMIT 50`,
        ["router", "admin"],
      );
      const details = plan.map((row) => row.detail).join(" | ");
      expect(details, field).toContain("USING COVERING INDEX");
      expect(details, field).not.toContain("TEMP B-TREE");
    }
  }).pipe(Effect.provide(layer)),
);

it.effect("treats counters that drop between refreshes as a reset, not exact usage", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const fresh = voucher("*1", "dropped");
    yield* store.replace(scope, [fresh], "t1");
    yield* store.replace(
      scope,
      [{ ...fresh, download: 900, lastSeen: "2026-11-24 10:00:00" }],
      "t2",
    );
    expect((yield* find("dropped")).remaining).toMatchObject({
      amount: 2 * GiB - 900,
      basis: "new",
    });
    yield* store.replace(
      scope,
      [{ ...fresh, download: 20, lastSeen: "2026-11-24 11:00:00" }],
      "t3",
    );
    expect((yield* find("dropped")).remaining).toMatchObject({
      amount: 2 * GiB - 20,
      basis: "counter-reset",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps a Madar activation when an unused voucher's comment changes", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const week = voucher("*1", "kept-week", { profile: "Week" });
    yield* store.replace(scope, [week], "t1");
    yield* store.upsert(scope, week, "2026-11-23 12:00:00");
    yield* store.replace(scope, [{ ...week, comment: "edited" }], "t2");
    expect((yield* find("kept-week")).remaining).toMatchObject({
      state: "ends",
      basis: "activation",
      endsAt: "2026-11-30 12:00:00",
    });
  }).pipe(Effect.provide(layer)),
);

it.effect("places time-only quotas after data quotas and blank flags last", () =>
  Effect.gen(function* () {
    const { store } = yield* setup;
    yield* store.replace(
      scope,
      [
        voucher("*1", "q-open", { profile: "Open" }),
        voucher("*2", "q-week", { profile: "Week", active: true }),
        voucher("*3", "q-data", { profile: "2GB", incomplete: true }),
        voucher("*4", "q-none", { profile: "" }),
      ],
      "t1",
    );
    const names = (sort: VoucherQuery["sort"]) =>
      store.list(query({ sort })).pipe(Effect.map((page) => page.items.map((row) => row.username)));
    expect(yield* names({ field: "quota", direction: "asc" })).toEqual([
      "q-data",
      "q-week",
      "q-none",
      "q-open",
    ]);
    expect(yield* names({ field: "flags", direction: "asc" })).toEqual([
      "q-data",
      "q-week",
      "q-none",
      "q-open",
    ]);
    expect(yield* names({ field: "activeFlag", direction: "desc" })).toEqual([
      "q-week",
      "q-data",
      "q-none",
      "q-open",
    ]);
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps a baseline when a counter becomes unreadable", () =>
  Effect.gen(function* () {
    const { store, find } = yield* setup;
    const used = voucher("*1", "blurred", {
      download: GiB,
      uptime: 600,
      lastSeen: "2026-11-24 10:00:00",
    });
    yield* store.replace(scope, [used], "t1");
    yield* store.upsert(scope, used, "2026-11-24 11:00:00");
    yield* store.replace(scope, [{ ...used, uptime: null }], "t2");
    expect((yield* find("blurred")).remaining).toMatchObject({
      amount: 2 * GiB,
      basis: "activation",
    });
    // A readable drop still counts as a reset while another counter is unreadable.
    yield* store.replace(scope, [{ ...used, download: 20, upload: null, uptime: null }], "t3");
    expect((yield* find("blurred")).remaining.basis).toBe("counter-reset");
  }).pipe(Effect.provide(layer)),
);

it.effect("rotates first-login lookups so failing reads do not block the others", () =>
  Effect.gen(function* () {
    const { store } = yield* setup;
    const day = (id: string, name: string) => voucher(id, name, { profile: "Day" });
    yield* store.replace(scope, [day("*1", "d-1"), day("*2", "d-2"), day("*3", "d-3")], "t1");
    yield* store.replace(
      scope,
      ["*1", "*2", "*3"].map((id, index) => ({
        ...day(id, `d-${index + 1}`),
        download: 10,
        lastSeen: `2026-11-24 13:0${index}:00`,
      })),
      "t2",
    );
    const first = yield* store.firstLoginCandidates(scope, 2);
    expect(first.map((item) => item.username)).toEqual(["d-3", "d-2"]);
    for (const candidate of first) yield* store.saveFirstLogin(scope, candidate, null, "failed");
    const next = yield* store.firstLoginCandidates(scope, 2);
    expect(next.map((item) => item.username)).toEqual(["d-1", "d-3"]);
  }).pipe(Effect.provide(layer)),
);
