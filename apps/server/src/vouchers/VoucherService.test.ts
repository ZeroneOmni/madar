import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import type { VoucherQuery, VoucherMutation } from "@madar/contracts";
import * as RouterApi from "../routers/RouterApi.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as VoucherStore from "./VoucherStore.ts";
import * as VoucherService from "./VoucherService.ts";
import { routerFixture } from "./routerFixture.ts";

const services = VoucherService.layer.pipe(
  Layer.provideMerge(VoucherStore.layer),
  Layer.provideMerge(RouterApi.layer),
  Layer.provideMerge(Sqlite.layerMemory),
);

it.live("records current and unattempted targets before a process loss after a router write", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(0)));
    const crashingApi = Layer.effect(
      RouterApi.RouterApi,
      Effect.gen(function* () {
        const api = yield* RouterApi.RouterApi;
        return RouterApi.RouterApi.of({
          ...api,
          execute: (profile, owner, words) =>
            api
              .execute(profile, owner, words)
              .pipe(
                Effect.tap(() =>
                  words[0]?.endsWith("/add") ? Effect.die("process loss") : Effect.void,
                ),
              ),
        });
      }),
    ).pipe(Layer.provide(RouterApi.layer));
    const crashServices = VoucherService.layer.pipe(
      Layer.provideMerge(VoucherStore.layer),
      Layer.provideMerge(crashingApi),
      Layer.provideMerge(Sqlite.layerMemory),
    );
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      const vouchers = yield* VoucherService.VoucherService;
      yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
      const input: VoucherMutation = {
        router: router.profile,
        customer: "admin",
        requestId: "crash-targets-000001",
        action: {
          kind: "create",
          items: [
            { username: "current-target", password: "secret-current" },
            { username: "later-target", password: "secret-later" },
          ],
          profile: "",
          sharedUsers: 1,
          comment: "",
        },
      };
      expect((yield* Effect.exit(vouchers.mutate(input, "owner")))._tag).toBe("Failure");
      expect([...router.users.values()].map((user) => user.username)).toEqual(["current-target"]);
      const history = yield* vouchers.history(input);
      expect(history[0]).toMatchObject({
        state: "running",
        outcomes: [
          { target: "current-target", state: "uncertain" },
          { target: "later-target", state: "pending" },
        ],
      });
      expect(JSON.stringify(history)).not.toContain("secret-");
      expect(yield* vouchers.mutate(input, "owner")).toEqual(history[0]);
      expect(router.commands.filter((words) => words[0]?.endsWith("/add"))).toHaveLength(1);
    }).pipe(Effect.provide(crashServices));
  }).pipe(Effect.scoped),
);

it.live(
  "syncs and pages locally, manages vouchers, and includes passwords in voucher details",
  () =>
    Effect.gen(function* () {
      const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(120)));
      yield* Effect.gen(function* () {
        const api = yield* RouterApi.RouterApi;
        const vouchers = yield* VoucherService.VoucherService;
        expect(
          yield* api.connect({ profile: router.profile, password: "fixture" }, "owner"),
        ).toMatchObject({ kind: "connected", version: "6.48.4" });
        const scope = { router: router.profile, customer: "admin" };
        yield* vouchers.sync(scope, "owner");
        const query: VoucherQuery = {
          ...scope,
          search: "",
          status: "all",
          profile: "",
          sort: { field: "username", direction: "asc" },
          offset: 50,
          limit: 50,
        };
        const calls = router.commands.length;
        const page = yield* vouchers.list(query);
        expect(page.total).toBe(120);
        expect(page.items).toHaveLength(50);
        expect(page.complete).toBe(true);
        expect(router.commands.length).toBe(calls);
        expect(JSON.stringify(page)).not.toContain("fixture-password");
        expect((yield* vouchers.details({ ...scope, id: "*1" }, "owner")).password).toBe(
          "fixture-password",
        );
        const create: VoucherMutation = {
          ...scope,
          requestId: "test-create-0000001",
          action: {
            kind: "create",
            items: [{ username: "new-voucher", password: "new-secret" }],
            profile: "Day",
            sharedUsers: 1,
            comment: "Batch",
          },
        };
        const created = yield* vouchers.mutate(create, "owner");
        expect(created.state).toBe("completed");
        const repeated = yield* vouchers.mutate(create, "owner");
        expect(repeated).toEqual(created);
        expect(router.commands.filter((words) => words[0]?.endsWith("/add"))).toHaveLength(1);
        const id = [...router.users.values()].find((user) => user.username === "new-voucher")![
          ".id"
        ]!;
        const edited = yield* vouchers.mutate(
          {
            ...scope,
            requestId: "test-edit-000000001",
            action: {
              kind: "edit",
              id,
              username: "edited-voucher",
              password: "replacement-secret",
              sharedUsers: 2,
              comment: "Updated note",
            },
          },
          "owner",
        );
        expect(edited.state).toBe("completed");
        expect((yield* vouchers.details({ ...scope, id }, "owner")).password).toBe(
          "replacement-secret",
        );
        expect(
          (yield* vouchers.list({ ...query, offset: 0, search: "updated note" })).items[0]
            ?.username,
        ).toBe("edited-voucher");
        for (const kind of [
          "disable",
          "enable",
          "assign-profile",
          "reset-counters",
          "remove",
        ] as const) {
          expect(
            (yield* vouchers.mutate(
              {
                ...scope,
                requestId: `test-${kind}-0000001`,
                action: { kind, ids: [id], profile: "Week" },
              },
              "owner",
            )).state,
          ).toBe("completed");
        }
        expect(router.users.has(id)).toBe(false);
        expect(JSON.stringify(yield* vouchers.history(scope))).not.toContain("new-secret");
      }).pipe(Effect.provide(services));
    }).pipe(Effect.scoped),
);

it.live("refreshes changed and removed vouchers without rewriting unchanged rows", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture()));
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      const vouchers = yield* VoucherService.VoucherService;
      const sql = yield* SqlClient.SqlClient;
      yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
      const scope = { router: router.profile, customer: "admin" };
      yield* vouchers.sync(scope, "owner");
      yield* sql`CREATE TABLE cache_write_audit (id TEXT)`;
      yield* sql`CREATE TRIGGER cache_write_insert AFTER INSERT ON voucher_cache BEGIN INSERT INTO cache_write_audit VALUES (new.id); END`;
      yield* sql`CREATE TRIGGER cache_write_update AFTER UPDATE ON voucher_cache BEGIN INSERT INTO cache_write_audit VALUES (new.id); END`;
      yield* sql`CREATE TRIGGER cache_write_delete AFTER DELETE ON voucher_cache BEGIN INSERT INTO cache_write_audit VALUES (old.id); END`;
      yield* vouchers.sync(scope, "owner");
      expect(yield* sql`SELECT * FROM cache_write_audit`).toEqual([]);
      router.users.get("*1")!.comment = "Changed";
      router.users.delete("*2");
      yield* vouchers.sync(scope, "owner");
      const changed = yield* sql<{ id: string }>`SELECT id FROM cache_write_audit`;
      expect(new Set(changed.map((row) => row.id))).toEqual(new Set(["*1", "*2"]));
      const page = yield* vouchers.list({
        ...scope,
        search: "",
        status: "all",
        profile: "",
        sort: { field: "username", direction: "asc" },
        offset: 0,
        limit: 50,
      });
      expect(page.total).toBe(2);
      expect(page.items[0]?.comment).toBe("Changed");
      expect(page.items.map((row) => row.id)).toEqual(["*1", "*3"]);
    }).pipe(Effect.provide(services));
  }).pipe(Effect.scoped),
);

it.live(
  "keeps a complete cache after an interrupted refresh and never replays an uncertain add",
  () =>
    Effect.gen(function* () {
      const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture()));
      yield* Effect.gen(function* () {
        const api = yield* RouterApi.RouterApi;
        const vouchers = yield* VoucherService.VoucherService;
        yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
        const scope = { router: router.profile, customer: "admin" };
        yield* vouchers.sync(scope, "owner");
        router.dropAfter("/tool/user-manager/user/print");
        expect((yield* Effect.exit(vouchers.sync(scope, "owner")))._tag).toBe("Failure");
        const query: VoucherQuery = {
          ...scope,
          search: "",
          status: "all",
          profile: "",
          sort: { field: "username", direction: "asc" },
          offset: 0,
          limit: 50,
        };
        expect((yield* vouchers.list(query)).total).toBe(3);
        router.dropAfter("/tool/user-manager/user/add");
        const input: VoucherMutation = {
          ...scope,
          requestId: "test-uncertain-00001",
          action: {
            kind: "create",
            items: [{ username: "uncertain", password: "private" }],
            profile: "Day",
            sharedUsers: 1,
            comment: "",
          },
        };
        const result = yield* vouchers.mutate(input, "owner");
        expect(result.outcomes[0]?.state).toBe("uncertain");
        yield* vouchers.mutate(input, "owner");
        expect(router.commands.filter((words) => words[0]?.endsWith("/add"))).toHaveLength(1);
        expect(router.users.size).toBe(4);
        expect((yield* api.status(router.profile.id, "owner")).kind).toBe("connected");
        expect((yield* api.status(router.profile.id, "different-owner")).kind).toBe("failed");
      }).pipe(Effect.provide(services));
    }).pipe(Effect.scoped),
);

it.live("reports profile failure as partial creation and prevents cross-customer writes", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture()));
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      const vouchers = yield* VoucherService.VoucherService;
      yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
      const scope = { router: router.profile, customer: "admin" };
      yield* vouchers.sync(scope, "owner");
      router.rejectNext("/tool/user-manager/user/create-and-activate-profile");
      const result = yield* vouchers.mutate(
        {
          ...scope,
          requestId: "test-partial-0000001",
          action: {
            kind: "create",
            items: [{ username: "partial", password: "private" }],
            profile: "Day",
            sharedUsers: 1,
            comment: "",
          },
        },
        "owner",
      );
      expect(result.outcomes[0]?.state).toBe("partial");
      const denied = yield* vouchers.mutate(
        {
          router: router.profile,
          customer: "other",
          requestId: "test-other-00000001",
          action: { kind: "remove", ids: ["*1"], profile: "" },
        },
        "owner",
      );
      expect(denied.outcomes[0]?.state).toBe("failed");
      expect(router.users.has("*1")).toBe(true);
    }).pipe(Effect.provide(services));
  }).pipe(Effect.scoped),
);

it.live("writes the router-local creation date on create and never in an edit", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(0)));
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      const vouchers = yield* VoucherService.VoucherService;
      const sql = yield* SqlClient.SqlClient;
      yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
      const scope = { router: router.profile, customer: "admin" };
      yield* vouchers.sync(scope, "owner");
      const created = yield* vouchers.mutate(
        {
          ...scope,
          requestId: "test-created-date-01",
          action: {
            kind: "create",
            items: [{ username: "dated", password: "secret" }],
            profile: "2GB",
            sharedUsers: 1,
            comment: "Shop",
          },
        },
        "owner",
      );
      expect(created.state).toBe("completed");
      const add = router.commands.find((words) => words[0]?.endsWith("/user/add"))!;
      const date = add.find((word) => word.startsWith("=registration-date="));
      expect(date).toMatch(/^=registration-date=nov\/24\/2026 08:39:\d\d$/);
      const [row] = (yield* vouchers.list({
        ...scope,
        search: "dated",
        status: "all",
        profile: "",
        sort: { field: "username", direction: "asc" },
        offset: 0,
        limit: 50,
      })).items;
      expect(row).toMatchObject({
        registrationDate: expect.stringMatching(/^2026-11-24 08:39:\d\d$/),
        // Activation applied the profile's override-shared-users; the router value wins.
        sharedUsers: 10,
        batch: { requested: 1, created: 1, profile: "2GB", comment: "Shop" },
        remaining: { state: "left", amount: 2147483648, basis: "activation" },
      });
      const id = row!.id;
      yield* vouchers.mutate(
        {
          ...scope,
          requestId: "test-edit-no-date-01",
          action: { kind: "edit", id, username: "dated", sharedUsers: 2, comment: "" },
        },
        "owner",
      );
      const edit = router.commands.find((words) => words[0]?.endsWith("/user/set"))!;
      expect(edit.some((word) => word.startsWith("=registration-date"))).toBe(false);
      const cached = JSON.stringify(yield* sql`SELECT * FROM voucher_cache`);
      for (const secret of ["secret", "fixture-psk", "fixture-reg-key"])
        expect(cached).not.toContain(secret);
    }).pipe(Effect.provide(services));
  }).pipe(Effect.scoped),
);

it.live("reads sessions for a bounded number of first logins per refresh", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(0)));
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      const vouchers = yield* VoucherService.VoucherService;
      yield* api.connect({ profile: router.profile, password: "fixture" }, "owner");
      const scope = { router: router.profile, customer: "admin" };
      const total = VoucherStore.FIRST_LOGIN_READS_PER_REFRESH + 5;
      for (let i = 1; i <= total; i++)
        router.users.set(`*${i}`, {
          ".id": `*${i}`,
          customer: "admin",
          username: `day-${i}`,
          "actual-profile": "Day",
          "download-used": "0",
          "upload-used": "0",
          "uptime-used": "0s",
          "last-seen": "never",
        });
      yield* vouchers.sync(scope, "owner");
      for (const user of router.users.values()) {
        user["download-used"] = "100";
        user["last-seen"] = "nov/24/2026 08:00:00";
        router.sessions.push(
          { user: user.username!, customer: "admin", "from-time": "nov/24/2026 07:00:00" },
          { user: user.username!, customer: "admin", "from-time": "nov/24/2026 07:30:00" },
        );
      }
      const sessionReads = () =>
        router.commands.filter((words) => words[0] === "/tool/user-manager/session/print").length;
      yield* vouchers.sync(scope, "owner");
      expect(sessionReads()).toBe(VoucherStore.FIRST_LOGIN_READS_PER_REFRESH);
      yield* vouchers.sync(scope, "owner");
      expect(sessionReads()).toBe(total);
      yield* vouchers.sync(scope, "owner");
      expect(sessionReads()).toBe(total);
      const page = yield* vouchers.list({
        ...scope,
        search: "",
        status: "all",
        profile: "",
        sort: { field: "username", direction: "asc" },
        offset: 0,
        limit: 50,
      });
      expect(page.items.every((row) => row.firstLoginAt === "2026-11-24 07:00:00")).toBe(true);
    }).pipe(Effect.provide(services));
  }).pipe(Effect.scoped),
);
