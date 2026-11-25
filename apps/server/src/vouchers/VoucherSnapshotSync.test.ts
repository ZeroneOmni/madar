// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";
import type { VoucherQuery, VoucherScope } from "@madar/contracts";
import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as RouterApi from "../routers/RouterApi.ts";
import * as RouterSftp from "../routers/RouterSftp.ts";
import { sftpFixture } from "../routers/sftpFixture.ts";
import * as VoucherService from "./VoucherService.ts";
import * as VoucherSnapshotReader from "./VoucherSnapshotReader.ts";
import * as VoucherSnapshotSync from "./VoucherSnapshotSync.ts";
import * as VoucherStore from "./VoucherStore.ts";
import { writeRouterDatabase } from "./routerDatabaseFixture.ts";
import { routerFixture } from "./routerFixture.ts";

const FILE = "user-manager/sqldb";
const JOURNAL = "user-manager/sqldb-journal";

/** Shared by every simulated process: the database, the router session and the data folder. */
const base = VoucherStore.layer.pipe(
  Layer.provideMerge(RouterApi.layer),
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "madar-router-copy-test-" })),
  Layer.provideMerge(NodeServices.layer),
);
/** One Madar process: in-memory copy state starts empty, persisted state carries over. */
const madarProcess = VoucherService.layer.pipe(
  Layer.provideMerge(VoucherSnapshotSync.layer),
  Layer.provide(Layer.merge(RouterSftp.layer, VoucherSnapshotReader.layer)),
);
const inProcess = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | VoucherService.VoucherService
    | VoucherSnapshotSync.VoucherSnapshotSync
    | VoucherStore.VoucherStore
  >,
) => Effect.provide(effect, madarProcess);

const harness = (options: Parameters<typeof sftpFixture>[1] = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "madar-router-db-" });
    const source = path.join(directory, "sqldb");
    writeRouterDatabase(source, {
      profiles: [{ id: 10, name: "Day" }],
      users: [1, 2, 3].map((id) => ({
        id,
        username: `voucher-${String(id).padStart(4, "0")}`,
        download: 200,
        upload: 100,
        uptime: 600,
        profileId: 10,
        profileName: "Day",
        start: Date.parse("2026-11-24T08:00:00Z") / 1000,
        assignments: [
          {
            id: 100 + id,
            profileId: 10,
            activated: Date.parse("2026-11-24T08:00:00Z") / 1000,
            counters: [{ download: 200, upload: 100, uptime: 600 }],
          },
        ],
      })),
    });
    const files = new Map([[FILE, { data: NodeFS.readFileSync(source), mtime: 1_700_000_000 }]]);
    const ssh = yield* Effect.acquireDisposable(Effect.promise(() => sftpFixture(files, options)));
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(3)));
    router.ssh.port = String(ssh.port);
    const api = yield* RouterApi.RouterApi;
    yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
    const scope: VoucherScope = { router: router.profile, customer: "admin" };
    const config = yield* ServerConfig.ServerConfig;
    const copies = path.join(config.stateDir, "router-copies");
    return { files, ssh, router, scope, copies, fs };
  });
const query = (scope: VoucherScope): VoucherQuery => ({
  ...scope,
  search: "",
  status: "all",
  profile: "",
  sort: { field: "username", direction: "asc" },
  offset: 0,
  limit: 50,
});
const addUsedVoucher = (router: Awaited<ReturnType<typeof routerFixture>>, id: string) =>
  router.users.set(id, {
    ".id": id,
    customer: "admin",
    username: `added-${id.slice(1)}`,
    disabled: "false",
    "actual-profile": "Day",
    "download-used": "5000",
    "upload-used": "0",
    "uptime-used": "1h",
    "last-seen": "nov/24/2026 08:00:00",
    "active-sessions": "0",
  });

it.effect("copies on first connection, shows package usage, and never copies at startup", () =>
  Effect.gen(function* () {
    const { ssh, scope } = yield* harness();
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        expect(yield* snapshots.settled(scope)).toMatchObject({
          outcome: "accepted",
          failure: null,
          hostKey: ssh.hostKey,
          job: null,
        });
        const row = (yield* vouchers.list(query(scope))).items[0]!;
        expect(row.package).toMatchObject({ download: 200, upload: 100, uptime: 600 });
        // A Madar reset ends the package the copy described, even before the outcome is known.
        yield* vouchers.mutate(
          {
            ...scope,
            requestId: "reset-copy-000000001",
            action: { kind: "reset-counters", ids: [row.id], profile: "" },
          },
          "owner",
        );
        expect((yield* vouchers.list(query(scope))).items[0]!.package).toBeNull();
      }),
    );
    expect(ssh.connections()).toBe(1);
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        expect(yield* snapshots.status(scope)).toMatchObject({ job: null, scheduledAt: null });
      }),
    );
    expect(ssh.connections()).toBe(1);
  }).pipe(Effect.scoped, Effect.provide(base)),
);

it.effect("combines triggers for a minute and keeps four hours between automatic copies", () =>
  Effect.gen(function* () {
    const { ssh, router, scope } = yield* harness();
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        yield* snapshots.settled(scope);
        addUsedVoucher(router, "*7");
        yield* vouchers.sync(scope, "owner");
        const { scheduledAt } = yield* snapshots.status(scope);
        expect(scheduledAt).not.toBeNull();
        router.users.get("*2")!["actual-profile"] = "Week";
        yield* vouchers.sync(scope, "owner");
        expect((yield* snapshots.status(scope)).scheduledAt).toBe(scheduledAt);
        yield* TestClock.adjust("1 minute");
        yield* snapshots.settled(scope);
        // The first copy counts as automatic, so the cooldown holds this one back.
        expect(ssh.connections()).toBe(1);
        yield* TestClock.adjust("4 hours");
        addUsedVoucher(router, "*8");
        yield* vouchers.sync(scope, "owner");
        yield* TestClock.adjust("1 minute");
        // The file did not change, so only its size, time and header were read.
        expect(yield* snapshots.settled(scope)).toMatchObject({ outcome: "unchanged" });
        expect(ssh.connections()).toBe(2);
      }),
    );
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        addUsedVoucher(router, "*9");
        yield* vouchers.sync(scope, "owner");
        yield* TestClock.adjust("1 minute");
        yield* snapshots.settled(scope);
        // The cooldown survives the restart.
        expect(ssh.connections()).toBe(2);
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(base)),
);

it.effect("rejects a copy that changed while it was read, then retries once", () =>
  Effect.gen(function* () {
    let touches = 0;
    const holder: { files?: Map<string, { data: Buffer; mtime: number }> } = {};
    const { files, ssh, scope, copies, fs } = yield* harness({
      onRead: () => {
        if (touches++ === 0) holder.files!.get(FILE)!.mtime++;
      },
    });
    holder.files = files;
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        const failed = yield* snapshots.settled(scope);
        expect(failed).toMatchObject({
          outcome: "failed",
          capturedAt: null,
          failure: { stage: "verify", reason: "changed" },
          paused: false,
        });
        expect(failed.scheduledAt).not.toBeNull();
        expect(yield* fs.readDirectory(copies)).toEqual([]);
        yield* TestClock.adjust("1 minute");
        expect(yield* snapshots.settled(scope)).toMatchObject({
          outcome: "accepted",
          failure: null,
        });
        // A journal means User Manager is writing; the copy is refused and retried only once.
        files.set(JOURNAL, { data: Buffer.alloc(512), mtime: 1 });
        yield* snapshots.start(scope, "owner");
        expect(yield* snapshots.settled(scope)).toMatchObject({
          outcome: "failed",
          failure: { stage: "check", reason: "changed" },
        });
        yield* TestClock.adjust("1 minute");
        const retried = yield* snapshots.settled(scope);
        expect(retried).toMatchObject({ outcome: "failed", scheduledAt: null });
        expect(retried.capturedAt).not.toBeNull();
        expect(ssh.connections()).toBe(4);
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(base)),
);

it.effect("pauses automatic copies on a changed host key until the new key is trusted", () =>
  Effect.gen(function* () {
    const { files, router, scope } = yield* harness();
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        yield* snapshots.settled(scope);
        const replaced = yield* Effect.acquireDisposable(Effect.promise(() => sftpFixture(files)));
        router.ssh.port = String(replaced.port);
        yield* snapshots.start(scope, "owner");
        const refused = yield* snapshots.settled(scope);
        expect(refused).toMatchObject({
          failure: { stage: "connect", reason: "host-key" },
          paused: true,
          offeredHostKey: replaced.hostKey,
          scheduledAt: null,
        });
        expect(replaced.connections()).toBe(1);
        yield* TestClock.adjust("5 hours");
        addUsedVoucher(router, "*7");
        yield* vouchers.sync(scope, "owner");
        yield* TestClock.adjust("1 minute");
        yield* snapshots.settled(scope);
        expect(replaced.connections()).toBe(1);
        yield* snapshots.trust(scope, replaced.hostKey);
        yield* snapshots.start(scope, "owner");
        expect(yield* snapshots.settled(scope)).toMatchObject({
          outcome: "accepted",
          paused: false,
          hostKey: replaced.hostKey,
        });
      }).pipe(Effect.scoped),
    );
  }).pipe(Effect.scoped, Effect.provide(base)),
);

it.effect("cancels a running copy, removes its file, and clears leftovers at startup", () =>
  Effect.gen(function* () {
    const reading = yield* Deferred.make<void>();
    let reads = 0;
    const { scope, copies, fs } = yield* harness({
      // The header read answers; the download's first read never does.
      stallAfter: 1,
      onRead: () => {
        if (++reads === 2) Deferred.doneUnsafe(reading, Effect.void);
      },
    });
    const path = yield* Path.Path;
    yield* inProcess(
      Effect.gen(function* () {
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        expect((yield* snapshots.start(scope, "owner")).job).toMatchObject({ trigger: "manual" });
        // A second click returns the running copy instead of starting another.
        expect((yield* snapshots.start(scope, "owner")).job).toMatchObject({ trigger: "manual" });
        yield* Deferred.await(reading);
        expect((yield* snapshots.status(scope)).job).toMatchObject({ stage: "download" });
        yield* snapshots.cancel(scope);
        expect(yield* snapshots.settled(scope)).toMatchObject({
          job: null,
          outcome: "cancelled",
          scheduledAt: null,
        });
        expect(yield* fs.readDirectory(copies)).toEqual([]);
      }),
    );
    yield* fs.writeFileString(path.join(copies, "left-by-a-crash.sqlite"), "partial");
    yield* inProcess(Effect.void);
    expect(yield* fs.readDirectory(copies)).toEqual([]);
  }).pipe(Effect.scoped, Effect.provide(base)),
);

it.effect("backs off for a day when SSH is off, and the API keeps working", () =>
  Effect.gen(function* () {
    const { ssh, router, scope } = yield* harness();
    router.ssh.disabled = "true";
    yield* inProcess(
      Effect.gen(function* () {
        const vouchers = yield* VoucherService.VoucherService;
        const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
        yield* vouchers.sync(scope, "owner");
        const off = yield* snapshots.settled(scope);
        expect(off).toMatchObject({ failure: { stage: "connect", reason: "ssh-off" } });
        expect(Date.parse(off.retryAt!) - Date.parse(off.checkedAt!)).toBe(24 * 3600 * 1000);
        router.ssh.disabled = "false";
        yield* TestClock.adjust("5 hours");
        addUsedVoucher(router, "*7");
        yield* vouchers.sync(scope, "owner");
        yield* TestClock.adjust("1 minute");
        yield* snapshots.settled(scope);
        expect(ssh.connections()).toBe(0);
        expect((yield* vouchers.list(query(scope))).total).toBe(4);
      }),
    );
  }).pipe(Effect.scoped, Effect.provide(base)),
);
