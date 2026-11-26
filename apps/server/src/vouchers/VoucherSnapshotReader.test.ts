// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeSqlite from "node:sqlite";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as VoucherSnapshotReader from "./VoucherSnapshotReader.ts";
import {
  SECRET_MARKER,
  pagesOf,
  splicePages,
  writeRouterDatabase,
  type FixtureOptions,
} from "./routerDatabaseFixture.ts";

const GiB = 1024 ** 3;
const at = (text: string) => Date.parse(`${text.replace(" ", "T")}Z`) / 1000;

const withFile = <A, E>(
  options: FixtureOptions | ((filename: string) => void),
  use: (filename: string) => Effect.Effect<A, E, VoucherSnapshotReader.VoucherSnapshotReader>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "madar-router-db-" });
    const filename = path.join(directory, "sqldb");
    if (typeof options === "function") options(filename);
    else writeRouterDatabase(filename, options);
    return yield* use(filename);
  }).pipe(
    Effect.scoped,
    Effect.provide(Layer.merge(VoucherSnapshotReader.layer, NodeServices.layer)),
  );

const twoPackages: FixtureOptions = {
  customers: [
    { id: 1, userName: "admin" },
    { id: 2, userName: "shop" },
  ],
  profiles: [
    { id: 10, name: "35GB" },
    { id: 11, name: "80GB" },
  ],
  users: [
    {
      id: 0x1a3,
      username: "card-001",
      current: 9,
      profileName: "80GB",
      start: at("2026-11-11 06:53:04"),
      end: at("2026-12-11 06:53:04"),
      limits: { transfer: 80 * GiB },
      assignments: [
        {
          id: 7,
          profileId: 10,
          added: at("2026-10-01 09:00:00"),
          activated: at("2026-10-01 09:00:05"),
          endTime: at("2026-11-11 06:50:00"),
          state: 1,
          price: 3000,
          counters: [{ download: 30 * GiB, upload: 5 * GiB, uptime: 7200 }],
        },
        {
          id: 9,
          profileId: 11,
          added: at("2026-11-11 06:52:00"),
          activated: at("2026-11-11 06:53:04"),
          state: 2,
          price: 6000,
          counters: [
            { download: 10 * GiB, upload: GiB, uptime: 600 },
            { download: 2 * GiB, upload: GiB, uptime: 60 },
          ],
        },
      ],
    },
    { id: 2, custId: 2, username: "unused", assignments: [] },
  ],
};

it.live("reads per-package usage, start and end, and history from a router database", () =>
  withFile(twoPackages, (filename) =>
    Effect.gen(function* () {
      const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
      const contents = yield* reader.read(filename);
      expect(contents.skipped).toBe(0);
      const card = contents.users.find((user) => user.username === "card-001");
      const unused = contents.users.find((user) => user.username === "unused");
      expect(card).toMatchObject({
        id: 0x1a3,
        customer: "admin",
        username: "card-001",
        profile: "80GB",
        lifetime: { download: 42 * GiB, upload: 7 * GiB, uptime: 7860 },
        quotaSignature: `${80 * GiB}:0:0:0`,
        current: {
          id: 9,
          profile: "80GB",
          startedAt: "2026-11-11 06:53:04",
          endsAt: "2026-12-11 06:53:04",
          usage: { download: 12 * GiB, upload: 2 * GiB, uptime: 660 },
        },
      });
      expect(card!.assignments.map((item) => [item.profile, item.price, item.state])).toEqual([
        ["80GB", 6000, 2],
        ["35GB", 3000, 1],
      ]);
      expect(card!.assignments[1]).toMatchObject({
        assignedAt: "2026-10-01 09:00:00",
        startedAt: "2026-10-01 09:00:05",
        endsAt: "2026-11-11 06:50:00",
      });
      expect(unused).toMatchObject({ customer: "shop", profile: "", current: null });
    }),
  ),
);

it.live("never selects password, registration key or wireless key columns", () =>
  Effect.gen(function* () {
    // Trapped secret columns fail any query that reads them, including SELECT *.
    const trapped = yield* withFile({ ...twoPackages, secrets: "trap" }, (filename) =>
      Effect.flatMap(VoucherSnapshotReader.VoucherSnapshotReader, (reader) =>
        reader.read(filename),
      ),
    );
    expect(trapped.users).toHaveLength(2);
    const plain = yield* withFile({ ...twoPackages, secrets: "values" }, (filename) =>
      Effect.flatMap(VoucherSnapshotReader.VoucherSnapshotReader, (reader) =>
        reader.read(filename),
      ),
    );
    expect(JSON.stringify(plain)).not.toContain(SECRET_MARKER);
  }),
);

it.live("skips users whose package counters exceed their lifetime counters", () =>
  withFile(
    {
      profiles: [{ id: 10, name: "Day" }],
      users: [
        {
          id: 1,
          username: "torn",
          download: GiB,
          upload: 0,
          uptime: 0,
          current: 1,
          profileName: "Day",
          assignments: [
            {
              id: 1,
              profileId: 10,
              activated: at("2026-11-20 10:00:00"),
              counters: [{ download: 2 * GiB, upload: 0, uptime: 0 }],
            },
          ],
        },
      ],
    },
    (filename) =>
      Effect.gen(function* () {
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        expect(yield* reader.read(filename)).toEqual({ users: [], skipped: 1 });
      }),
  ),
);

it.live("takes the current package from the assignment the user row names", () =>
  withFile(
    {
      profiles: [
        { id: 10, name: "Day" },
        { id: 11, name: "Week" },
      ],
      users: [
        {
          id: 1,
          username: "waiting",
          // The newer package is assigned but has not started; the user row names it.
          current: 2,
          profileName: "Week",
          assignments: [
            { id: 1, profileId: 10, activated: at("2026-11-20 10:00:00") },
            { id: 2, profileId: 11, added: at("2026-11-21 10:00:00"), activated: -2 },
          ],
        },
        // An id that is not one of this user's assignments names nothing.
        { id: 2, username: "stray", current: 1, profileName: "Day", assignments: [] },
      ],
    },
    (filename) =>
      Effect.gen(function* () {
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        const { users } = yield* reader.read(filename);
        expect(users.find((user) => user.username === "waiting")?.current).toMatchObject({
          id: 2,
          profile: "Week",
          assignedAt: "2026-11-21 10:00:00",
          startedAt: null,
        });
        expect(users.find((user) => user.username === "stray")?.current).toBeNull();
      }),
  ),
);

it.live("fails closed on an unknown layout, wrong types, and damaged or truncated files", () =>
  Effect.gen(function* () {
    const failure = (options: FixtureOptions | ((filename: string) => void)) =>
      withFile(options, (filename) =>
        Effect.flatMap(VoucherSnapshotReader.VoucherSnapshotReader, (reader) =>
          Effect.flip(reader.read(filename)),
        ),
      );
    const missing = yield* failure({
      users: [],
      ddl: {
        ucounters:
          "CREATE TABLE ucounters (id INTEGER PRIMARY KEY, userId INTEGER, upload INTEGER, download INTEGER, uptime INTEGER)",
      },
    });
    expect(missing).toMatchObject({ reason: "schema", table: "ucounters" });
    const retyped = yield* failure({
      users: [],
      ddl: {
        userprofile:
          "CREATE TABLE userprofile (id INTEGER PRIMARY KEY, userId INTEGER, profileId INTEGER, price INTEGER, validUntil INTEGER, added INTEGER, activated TEXT, state INTEGER, endTime INTEGER)",
      },
    });
    expect(retyped).toMatchObject({ reason: "schema", table: "userprofile" });
    // Earlier guesses named the customer column "login"; User Manager 6 calls it userName.
    const renamed = yield* failure((filename) => {
      writeRouterDatabase(filename, { users: [] });
      const sqlite = new NodeSqlite.DatabaseSync(filename);
      sqlite.exec("ALTER TABLE customer RENAME COLUMN userName TO login");
      sqlite.close();
    });
    expect(renamed).toMatchObject({ reason: "schema", table: "customer", column: "userName" });
    // Rowid reads need `id` to be the rowid; "INT PRIMARY KEY" is an ordinary indexed column.
    const keyed = yield* failure({
      users: [],
      ddl: {
        ucounters:
          "CREATE TABLE ucounters (id INT PRIMARY KEY, userId INTEGER, uprofileId INTEGER, upload INTEGER, download INTEGER, uptime INTEGER)",
      },
    });
    expect(keyed).toMatchObject({ reason: "schema", table: "ucounters", column: "id" });
    const text = yield* failure((filename) => {
      writeRouterDatabase(filename, { users: [{ id: 1, username: "a" }], secrets: "values" });
      const sqlite = new NodeSqlite.DatabaseSync(filename);
      sqlite.exec("UPDATE user SET downloadUsed = 'lots'");
      sqlite.close();
    });
    expect(text).toMatchObject({ reason: "values", table: "user" });
    const negative = yield* failure({
      profiles: [{ id: 10, name: "Day" }],
      users: [
        {
          id: 1,
          username: "a",
          download: 0,
          upload: 0,
          uptime: 0,
          assignments: [
            { id: 1, profileId: 10, counters: [{ download: -5, upload: 0, uptime: 0 }] },
          ],
        },
      ],
    });
    expect(negative).toMatchObject({ reason: "values", table: "ucounters" });
    const truncated = yield* failure((filename) => {
      writeRouterDatabase(filename, twoPackages);
      const bytes = NodeFS.readFileSync(filename);
      NodeFS.writeFileSync(filename, bytes.subarray(0, Math.floor(bytes.length / 2)));
    });
    // A file that ends early is a copy cut short while the router wrote, not another file.
    expect(truncated.reason).toBe("torn");
    const garbage = yield* failure((filename) => {
      NodeFS.writeFileSync(filename, Buffer.alloc(8192, 7));
    });
    expect(garbage.reason).toBe("corrupt");
  }),
);

it.live("reads User Manager's not-set markers as no value and no limit", () =>
  withFile(
    {
      profiles: [{ id: 10, name: "Day" }],
      users: [
        {
          id: 1,
          username: "unset",
          current: 1,
          profileName: "Day",
          // User Manager 6 writes -1 and -2 for "not set".
          start: -2,
          end: -2,
          limits: { transfer: -1, download: -1, upload: -1, uptime: -1 },
          assignments: [
            {
              id: 1,
              profileId: 10,
              activated: at("2026-11-20 10:00:00"),
              endTime: -2,
              validUntil: 0,
              counters: [{ download: 80_000_000_000, upload: 0, uptime: 60 }],
            },
          ],
        },
        { id: 2, username: "never", current: null, profileName: null, start: null, end: null },
      ],
    },
    (filename) =>
      Effect.gen(function* () {
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        const { users, skipped } = yield* reader.read(filename);
        expect(skipped).toBe(0);
        expect(users.find((user) => user.username === "unset")).toMatchObject({
          quotaSignature: "0:0:0:0",
          lifetime: { download: 80_000_000_000 },
          current: { id: 1, startedAt: "2026-11-20 10:00:00", endsAt: null },
        });
        expect(users.find((user) => user.username === "never")).toMatchObject({
          profile: "",
          current: null,
          assignments: [],
        });
      }),
  ),
);

const many: FixtureOptions = {
  secrets: "values",
  profiles: [{ id: 10, name: "Day" }],
  users: Array.from({ length: 300 }, (_, index) => ({
    id: index + 1,
    username: `card-${String(index + 1).padStart(4, "0")}`,
    current: index + 1,
    profileName: "Day",
    start: at("2026-11-20 10:00:00"),
    end: at("2026-11-21 10:00:00"),
    assignments: [
      {
        id: index + 1,
        profileId: 10,
        activated: at("2026-11-20 10:00:00"),
        counters: [{ download: 1000 + index, upload: 0, uptime: 60 }],
      },
    ],
  })),
};
/**
 * A copy taken while User Manager committed `change`: each page is whole, from before or after
 * it. `fromAfter` picks pages by the tables and indexes that hold them after the change.
 */
const tornCopy =
  (change: string, fromAfter: (pages: Map<string, Set<number>>, page: number) => boolean) =>
  (filename: string) => {
    writeRouterDatabase(filename, many);
    const before = NodeFS.readFileSync(filename);
    const sqlite = new NodeSqlite.DatabaseSync(filename);
    sqlite.exec(change);
    sqlite.close();
    const pages = pagesOf(filename);
    const after = NodeFS.readFileSync(filename);
    NodeFS.writeFileSync(
      filename,
      splicePages(before, after, (page) => fromAfter(pages, page)),
    );
  };
const query = (filename: string, sql: string) => {
  const sqlite = new NodeSqlite.DatabaseSync(filename, { readOnly: true });
  try {
    return sqlite.prepare(sql).all();
  } finally {
    sqlite.close();
  }
};

it.live("reads tables whose indexes were torn by a write during the copy", () =>
  withFile(
    tornCopy(
      `UPDATE user SET actualProfileEnd = ${at("2026-11-22 10:00:00")} WHERE id % 3 = 0`,
      // The tables after the write, the user indexes from before it.
      (pages, page) =>
        !pages.get("user_actprofend_index")!.has(page) &&
        !pages.get("user_custact_index")!.has(page),
    ),
    (filename) =>
      Effect.gen(function* () {
        expect(query(filename, "PRAGMA integrity_check")).not.toEqual([{ integrity_check: "ok" }]);
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        const { users, skipped } = yield* reader.read(filename);
        expect(skipped).toBe(0);
        expect(users).toHaveLength(300);
        expect(users.find((user) => user.id === 3)?.current?.endsAt).toBe("2026-11-22 10:00:00");
        expect(users.find((user) => user.id === 4)?.current?.endsAt).toBe("2026-11-21 10:00:00");
      }),
  ),
);

it.live("rejects a copy whose table pages were torn, which repeats some rows", () =>
  withFile(
    tornCopy(
      "UPDATE user SET userName = userName || '-renewed-with-a-longer-name' WHERE id BETWEEN 100 AND 160",
      (pages, page) => !(pages.get("user")!.has(page) && page % 2 === 0),
    ),
    (filename) =>
      Effect.gen(function* () {
        const ids = query(filename, "SELECT id FROM user NOT INDEXED").map((row) => row.id);
        expect(new Set(ids).size).toBeLessThan(ids.length);
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        expect(yield* Effect.flip(reader.read(filename))).toMatchObject({
          reason: "torn",
          table: "user",
        });
      }),
  ),
);

it.live("never rolls back a journal that sits beside the copy", () =>
  withFile(
    (filename) => {
      writeRouterDatabase(filename, many);
      // A writer stopped mid-transaction leaves a hot journal and half-written pages.
      const writer = new NodeSqlite.DatabaseSync(filename);
      writer.exec("PRAGMA cache_size = 1; BEGIN; UPDATE user SET downloadUsed = downloadUsed + 1");
      NodeFS.copyFileSync(filename, `${filename}.copy`);
      NodeFS.copyFileSync(`${filename}-journal`, `${filename}.copy-journal`);
      writer.exec("ROLLBACK");
      writer.close();
      NodeFS.renameSync(`${filename}.copy`, filename);
      NodeFS.renameSync(`${filename}.copy-journal`, `${filename}-journal`);
    },
    (filename) =>
      Effect.gen(function* () {
        const journal = NodeFS.readFileSync(`${filename}-journal`);
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        expect((yield* reader.read(filename)).users).toHaveLength(300);
        expect(NodeFS.readFileSync(`${filename}-journal`)).toEqual(journal);
      }),
  ),
);
