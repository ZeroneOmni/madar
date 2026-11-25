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
    { id: 1, login: "admin" },
    { id: 2, login: "shop" },
  ],
  profiles: [
    { id: 10, name: "35GB" },
    { id: 11, name: "80GB" },
  ],
  users: [
    {
      id: 0x1a3,
      username: "card-001",
      profileId: 11,
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
          profileId: 10,
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

it.live("treats two running assignments of the same start as no current package", () =>
  withFile(
    {
      profiles: [{ id: 10, name: "Day" }],
      users: [
        {
          id: 1,
          username: "twin",
          profileId: 10,
          profileName: "Day",
          assignments: [1, 2].map((id) => ({
            id,
            profileId: 10,
            activated: at("2026-11-20 10:00:00"),
          })),
        },
      ],
    },
    (filename) =>
      Effect.gen(function* () {
        const reader = yield* VoucherSnapshotReader.VoucherSnapshotReader;
        const [user] = (yield* reader.read(filename)).users;
        expect(user?.current).toBeNull();
        expect(user?.assignments).toHaveLength(2);
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
    expect(truncated.reason).toBe("corrupt");
    const garbage = yield* failure((filename) => {
      NodeFS.writeFileSync(filename, Buffer.alloc(8192, 7));
    });
    expect(garbage.reason).toBe("corrupt");
  }),
);
