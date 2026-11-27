import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Semaphore from "effect/Semaphore";
import {
  VoucherFailure,
  type RouterProfile,
  type VoucherCatalog,
  type VoucherPage,
  type VoucherScope,
  type VoucherQuery,
  type VoucherTarget,
  type VoucherDetails,
  type VoucherMutation,
  type VoucherOperation,
} from "@madar/contracts";
import * as RouterApi from "../routers/RouterApi.ts";
import * as VoucherStore from "./VoucherStore.ts";
import * as VoucherSnapshotSync from "./VoucherSnapshotSync.ts";
import * as Values from "./routerValues.ts";

const userMenu = "/tool/user-manager/user";
// Strict allowlist: passwords, reg-key and wireless keys are never requested.
const fields = [
  ".id",
  "customer",
  "username",
  "disabled",
  "active",
  "incomplete",
  "actual-profile",
  "shared-users",
  "comment",
  "upload-used",
  "download-used",
  "uptime-used",
  "last-seen",
  "active-sessions",
  "registration-date",
  "caller-id",
  "caller-id-bind-on-first-use",
  "ip-address",
  "ipv6-dns",
  "ipv6-prefix",
  "wireless-enc-algo",
  "first-name",
  "last-name",
  "phone",
  "email",
  "location",
].join(",");
type ApiRow = Readonly<Record<string, string>>;
/** Parses one router row; unparseable values become null and only the field name is reported. */
function toVoucher(row: ApiRow, time: string) {
  const failed: string[] = [];
  const parse = <A>(field: string, parser: (text: string) => A | null, empty: "null" | "fail") => {
    const text = row[field] ?? "";
    if (!text.trim()) {
      if (empty === "fail") failed.push(field);
      return null;
    }
    const value = parser(text);
    if (value === null) failed.push(field);
    return value;
  };
  // RouterOS 6 leaves zero values out of the print instead of sending "0".
  const counter = (field: string, parser: (text: string) => number | null) =>
    field in row ? parse(field, parser, "fail") : 0;
  const lastSeenText = row["last-seen"] ?? "";
  const shared = Values.parseSharedUsers(row["shared-users"] ?? "");
  if (shared.count === null && !shared.unlimited && row["shared-users"])
    failed.push("shared-users");
  const voucher: VoucherStore.RouterVoucher = {
    id: row[".id"] ?? "",
    customer: row.customer ?? "",
    username: row.username ?? row.name ?? "",
    comment: row.comment ?? "",
    disabled: Values.parseFlag(row.disabled),
    active: Values.parseFlag(row.active),
    incomplete: Values.parseFlag(row.incomplete),
    profile: row["actual-profile"] ?? "",
    sharedUsers: shared.unlimited ? "unlimited" : shared.count,
    download: counter("download-used", Values.parseBytes),
    upload: counter("upload-used", Values.parseBytes),
    uptime: counter("uptime-used", Values.parseDuration),
    lastSeen:
      lastSeenText.trim() === "never"
        ? "never"
        : parse("last-seen", Values.parseRouterDateTime, "null"),
    activeSessions: counter("active-sessions", Values.parseCount),
    registrationDate: parse("registration-date", Values.parseRouterDateTime, "null"),
    callerId: row["caller-id"] ?? "",
    callerIdBind: Values.parseFlag(row["caller-id-bind-on-first-use"]),
    ipAddress: row["ip-address"] ?? "",
    ipv6Dns: row["ipv6-dns"] ?? "",
    ipv6Prefix: row["ipv6-prefix"] ?? "",
    wirelessEncryption: row["wireless-enc-algo"] ?? "",
    firstName: row["first-name"] ?? "",
    lastName: row["last-name"] ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    location: row.location ?? "",
    observedAt: time,
  };
  return { voucher, failed };
}
const logParseFailures = (failed: readonly string[]) => {
  if (failed.length === 0) return Effect.void;
  const counts: Record<string, number> = {};
  for (const field of failed) counts[field] = (counts[field] ?? 0) + 1;
  return Effect.logWarning("Unparsed User Manager values were cached as empty", counts);
};
const parseRows = Effect.fn("VoucherService.parseRows")(function* (
  rows: readonly ApiRow[],
  time: string,
) {
  const parsed = rows.map((row) => toVoucher(row, time));
  yield* logParseFailures(parsed.flatMap((item) => item.failed));
  return parsed.map((item) => item.voucher);
});
const failure = (error: RouterApi.RouterApiError) => new VoucherFailure({ reason: error.reason });
const isUncertain = (error: VoucherFailure) =>
  ["network", "timeout", "protocol", "storage"].includes(error.reason);

export class VoucherService extends Context.Service<
  VoucherService,
  {
    readonly catalog: (router: RouterProfile) => Effect.Effect<VoucherCatalog, VoucherFailure>;
    readonly discover: (
      router: RouterProfile,
      owner: string,
    ) => Effect.Effect<VoucherCatalog, VoucherFailure>;
    readonly list: (query: VoucherQuery) => Effect.Effect<VoucherPage, VoucherFailure>;
    readonly sync: (
      scope: VoucherScope,
      owner: string,
    ) => Effect.Effect<VoucherCatalog, VoucherFailure>;
    readonly details: (
      target: VoucherTarget,
      owner: string,
    ) => Effect.Effect<VoucherDetails, VoucherFailure>;
    readonly mutate: (
      input: VoucherMutation,
      owner: string,
    ) => Effect.Effect<VoucherOperation, VoucherFailure>;
    readonly history: (
      scope: VoucherScope,
    ) => Effect.Effect<readonly VoucherOperation[], VoucherFailure>;
  }
>()("madar/vouchers/VoucherService") {}

const make = Effect.gen(function* () {
  const api = yield* RouterApi.RouterApi;
  const store = yield* VoucherStore.VoucherStore;
  const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
  const lock = yield* Semaphore.make(1);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const read = Effect.fn("VoucherService.read")(
    (scope: VoucherScope, owner: string, words: readonly string[]) =>
      api.execute(scope.router, owner, words).pipe(Effect.mapError(failure)),
  );
  /** Router-local epoch seconds minus PC epoch seconds, from one clock read. */
  const clockOffset = Effect.fn("VoucherService.clockOffset")(function* (
    scope: VoucherScope,
    owner: string,
  ) {
    const rows = yield* read(scope, owner, ["/system/clock/print", "=.proplist=time,date"]);
    const local = Values.parseRouterDateTime(`${rows[0]?.date ?? ""} ${rows[0]?.time ?? ""}`);
    if (!local) return yield* new VoucherFailure({ reason: "protocol" });
    const pc = yield* Clock.currentTimeMillis;
    return Math.round((Values.naiveToEpoch(local) - pc) / 1000);
  });
  const find = Effect.fn("VoucherService.find")(function* (
    scope: VoucherScope,
    owner: string,
    id: string,
    activatedAt?: string | null,
  ) {
    // Taken before the read: a login after it must not fall before Madar's first-sighting cutoff.
    const time = yield* now;
    const rows = yield* read(scope, owner, [
      `${userMenu}/print`,
      `=.proplist=${fields}`,
      `?.id=${id}`,
      `?customer=${scope.customer}`,
    ]);
    if (rows.length !== 1 || rows[0]![".id"] !== id || rows[0]!.customer !== scope.customer)
      return yield* new VoucherFailure({ reason: "not-found" });
    const [voucher] = yield* parseRows(rows, time);
    yield* store.upsert(scope, voucher!, activatedAt);
    return voucher!;
  });
  const discover = Effect.fn("VoucherService.discover")(function* (
    router: RouterProfile,
    owner: string,
  ) {
    const scope = { router, customer: "" };
    const customers = yield* read(scope, owner, [
      "/tool/user-manager/customer/print",
      "=.proplist=login",
    ]);
    const profiles = yield* read(scope, owner, [
      "/tool/user-manager/profile/print",
      "=.proplist=name,owner,name-for-users,validity,starts-at,price,override-shared-users",
    ]);
    const limitations = yield* read(scope, owner, [
      "/tool/user-manager/profile/limitation/print",
      "=.proplist=name,owner,transfer-limit,download-limit,upload-limit,uptime-limit",
    ]);
    const links = yield* read(scope, owner, [
      "/tool/user-manager/profile/profile-limitation/print",
      "=.proplist=profile,limitation,from-time,till-time,weekdays",
    ]);
    // A missing clock only disables expiry estimates; it must not block the refresh.
    const offset = yield* clockOffset(scope, owner).pipe(Effect.orElseSucceed(() => null));
    const failed: string[] = [];
    const parse = <A>(field: string, text: string, parser: (text: string) => A | null) => {
      const value = parser(text);
      if (value === null) failed.push(field);
      return value;
    };
    const time = yield* now;
    const input: VoucherStore.CatalogInput = {
      customers: customers.map((row) => row.login ?? row.name ?? "").filter(Boolean),
      profiles: profiles.flatMap((row) => {
        if (!row.name) return [];
        const shared = Values.parseSharedUsers(row["override-shared-users"] ?? "");
        return [
          {
            name: row.name,
            owner: row.owner ?? "",
            nameForUsers: row["name-for-users"] ?? "",
            validity: parse("validity", row.validity || "0s", Values.parseDuration),
            startsAt: row["starts-at"] ?? "",
            price: row.price ? parse("price", row.price, Values.parsePrice) : null,
            overrideSharedUsers: shared.unlimited ? ("unlimited" as const) : shared.count,
          },
        ];
      }),
      limitations: limitations.flatMap((row) =>
        row.name
          ? [
              {
                name: row.name,
                owner: row.owner ?? "",
                transfer: parse("transfer-limit", row["transfer-limit"] || "0", Values.parseBytes),
                download: parse("download-limit", row["download-limit"] || "0", Values.parseBytes),
                upload: parse("upload-limit", row["upload-limit"] || "0", Values.parseBytes),
                uptime: parse("uptime-limit", row["uptime-limit"] || "0s", Values.parseDuration),
              },
            ]
          : [],
      ),
      profileLimitations: links.flatMap((row) =>
        row.profile && row.limitation
          ? [
              {
                profile: row.profile,
                limitation: row.limitation,
                fromTime: parse("from-time", row["from-time"] || "0s", Values.parseDuration),
                tillTime: parse("till-time", row["till-time"] || "23h59m59s", Values.parseDuration),
                weekdays: parse("weekdays", row.weekdays ?? "", Values.parseWeekdays),
              },
            ]
          : [],
      ),
      syncedAt: time,
      clockOffset: offset,
    };
    yield* logParseFailures(failed);
    yield* store.saveCatalog(RouterApi.routerKey(router), input);
    return yield* store.catalog(RouterApi.routerKey(router));
  });
  /** Bounded, per-user session reads that find the first login after the current activation. */
  const checkFirstLogins = Effect.fn("VoucherService.checkFirstLogins")(function* (
    scope: VoucherScope,
    owner: string,
  ) {
    const candidates = yield* store.firstLoginCandidates(
      scope,
      VoucherStore.FIRST_LOGIN_READS_PER_REFRESH,
    );
    for (const candidate of candidates) {
      // The voucher refresh is already saved; a failed lookup is retried at the next refresh.
      const sessions = yield* read(scope, owner, [
        "/tool/user-manager/session/print",
        "=.proplist=from-time",
        `?user=${candidate.username}`,
        `?customer=${scope.customer}`,
      ]).pipe(Effect.orElseSucceed(() => null));
      if (sessions === null) {
        yield* store.saveFirstLogin(scope, candidate, null, "failed");
        continue;
      }
      const starts = sessions
        .map((row) => Values.parseRouterDateTime(row["from-time"] ?? ""))
        .filter((value): value is string => value !== null && value >= candidate.sessionsAfter)
        .sort();
      yield* store.saveFirstLogin(scope, candidate, starts[0] ?? null);
    }
  });
  const sync = Effect.fn("VoucherService.sync")(function* (scope: VoucherScope, owner: string) {
    const catalog = yield* discover(scope.router, owner);
    if (!catalog.customers.includes(scope.customer))
      return yield* new VoucherFailure({ reason: "not-found" });
    const time = yield* now;
    const rows = yield* read(scope, owner, [
      `${userMenu}/print`,
      `=.proplist=${fields}`,
      `?customer=${scope.customer}`,
    ]);
    const vouchers = yield* parseRows(rows, time);
    if (
      vouchers.some(
        (voucher) => !voucher.id || !voucher.username || voucher.customer !== scope.customer,
      )
    )
      return yield* new VoucherFailure({ reason: "protocol" });
    const signals = yield* store.replace(scope, vouchers, time);
    yield* checkFirstLogins(scope, owner);
    // Copying runs in its own fiber, outside this lock.
    yield* snapshots.observe(scope, owner, signals);
    return catalog;
  }, lock.withPermits(1));
  const details = Effect.fn("VoucherService.details")(function* (
    target: VoucherTarget,
    owner: string,
  ) {
    const found = yield* find(target, owner, target.id);
    const voucher = yield* store.row(target, target.id);
    const rows = yield* read(target, owner, [
      `${userMenu}/print`,
      "=.proplist=.id,customer,password",
      `?.id=${target.id}`,
      `?customer=${target.customer}`,
    ]);
    const password = rows[0]?.password ?? null;
    const sessions = yield* read(target, owner, [
      "/tool/user-manager/session/print",
      "=.proplist=.id,user,customer,active,started,ended,uptime,upload,download,from-time,till-time,host-ip,calling-station-id",
      `?user=${found.username}`,
      `?customer=${target.customer}`,
    ]).pipe(
      Effect.map((rows) => ({ sessions: rows.slice(-100), sessionsAvailable: true })),
      Effect.orElseSucceed(() => ({ sessions: [], sessionsAvailable: false })),
    );
    return { voucher, password, ...sessions };
  }, lock.withPermits(1));
  const mutate = Effect.fn("VoucherService.mutate")(
    function* (input: VoucherMutation, owner: string) {
      const previous = yield* store.operation(input, input.requestId);
      if (previous) return previous;
      const action = input.action;
      if ((action.kind === "assign-profile" || action.kind === "create") && action.profile) {
        const catalog = yield* store.catalog(RouterApi.routerKey(input.router));
        if (
          !catalog.profiles.some(
            (profile) =>
              profile.name === action.profile &&
              (!profile.owner || profile.owner === input.customer),
          )
        )
          return yield* new VoucherFailure({ reason: "not-found" });
      }
      if (action.kind === "assign-profile" && !action.profile)
        return yield* new VoucherFailure({ reason: "rejected" });
      const targets =
        action.kind === "create"
          ? action.items.map((item) => item.username)
          : action.kind === "edit"
            ? [action.id]
            : [...new Set(action.ids)];
      let operation: VoucherOperation = {
        requestId: input.requestId,
        kind: action.kind,
        createdAt: yield* now,
        state: "running",
        outcomes: targets.map((target) => ({ target, state: "pending", reason: "" })),
      };
      yield* store.saveOperation(input, operation);
      // One router clock read per operation; later times add the PC's elapsed time to it.
      const clock =
        action.kind === "create" || action.kind === "assign-profile"
          ? yield* clockOffset(input, owner).pipe(Effect.orElseSucceed(() => null))
          : null;
      const routerNow = Effect.gen(function* () {
        if (clock === null) return null;
        return Values.epochToNaive((yield* Clock.currentTimeMillis) + clock * 1000);
      });
      const batch =
        action.kind === "create"
          ? yield* store.createBatch(input, {
              requestId: input.requestId,
              createdAt: operation.createdAt,
              requested: action.items.length,
              profile: action.profile,
              comment: action.comment,
            })
          : null;
      for (let index = 0; index < targets.length; index++) {
        const target = targets[index]!;
        operation = {
          ...operation,
          outcomes: operation.outcomes.map((outcome, position) =>
            position === index ? { ...outcome, state: "uncertain" } : outcome,
          ),
        };
        yield* store.saveOperation(input, operation);
        let written = false;
        const changesPackage =
          action.kind === "assign-profile" ||
          action.kind === "reset-counters" ||
          action.kind === "remove";
        const result = yield* Effect.gen(function* () {
          let id = target;
          if (action.kind === "create") {
            const item = action.items[index]!;
            const existing = yield* read(input, owner, [
              `${userMenu}/print`,
              "=.proplist=.id",
              `?username=${item.username}`,
              `?customer=${input.customer}`,
            ]);
            if (existing.length) return yield* new VoucherFailure({ reason: "conflict" });
            const created = yield* routerNow;
            yield* read(input, owner, [
              `${userMenu}/add`,
              `=customer=${input.customer}`,
              `=username=${item.username}`,
              `=password=${item.password}`,
              `=shared-users=${action.sharedUsers}`,
              `=comment=${action.comment}`,
              // Never sent empty: RouterOS stores the current UTC time for an empty value.
              ...(created ? [`=registration-date=${Values.formatRouterDateTime(created)}`] : []),
            ]);
            written = true;
            const rows = yield* read(input, owner, [
              `${userMenu}/print`,
              "=.proplist=.id",
              `?username=${item.username}`,
              `?customer=${input.customer}`,
            ]);
            if (rows.length !== 1 || !rows[0]![".id"])
              return yield* new VoucherFailure({ reason: "protocol" });
            id = rows[0]![".id"]!;
            yield* store.addBatchMember(input, batch!, item.username, id);
            yield* find(input, owner, id);
            if (action.profile) {
              yield* read(input, owner, [
                `${userMenu}/create-and-activate-profile`,
                `=customer=${input.customer}`,
                `=profile=${action.profile}`,
                `=numbers=${id}`,
              ]);
              yield* find(input, owner, id, yield* routerNow);
            }
            return { target, state: "confirmed", reason: "" } as const;
          }
          yield* find(input, owner, id);
          // A package change, reset or removal ends what a router database copy described,
          // even when the command's outcome turns out uncertain.
          if (changesPackage) yield* store.invalidateSnapshots(input, [id]);
          if (action.kind === "edit") {
            // registration-date is never part of an edit; see the create branch.
            yield* read(input, owner, [
              `${userMenu}/set`,
              `=.id=${id}`,
              `=username=${action.username}`,
              `=shared-users=${action.sharedUsers}`,
              `=comment=${action.comment}`,
              ...(action.password === undefined ? [] : [`=password=${action.password}`]),
            ]);
          } else if (action.kind === "assign-profile") {
            yield* read(input, owner, [
              `${userMenu}/create-and-activate-profile`,
              `=numbers=${id}`,
              `=customer=${input.customer}`,
              `=profile=${action.profile}`,
            ]);
          } else
            yield* read(input, owner, [
              `${userMenu}/${action.kind}`,
              `=${action.kind === "reset-counters" ? "numbers" : ".id"}=${id}`,
            ]);
          written = true;
          if (action.kind === "remove") yield* store.remove(input, id);
          else
            yield* find(
              input,
              owner,
              id,
              action.kind === "assign-profile" ? yield* routerNow : undefined,
            );
          return { target, state: "confirmed", reason: "" } as const;
        }).pipe(
          Effect.catch((error: VoucherFailure) =>
            Effect.succeed({
              target,
              state: isUncertain(error)
                ? ("uncertain" as const)
                : written
                  ? ("partial" as const)
                  : ("failed" as const),
              reason: error.reason,
            }),
          ),
          // Again once the command ended: a copy that began while it ran may predate it.
          Effect.tap(() =>
            changesPackage
              ? Effect.ignore(store.invalidateSnapshots(input, [target]))
              : Effect.void,
          ),
        );
        operation = {
          ...operation,
          outcomes: operation.outcomes.map((outcome, position) =>
            position === index ? result : outcome,
          ),
        };
        yield* store.saveOperation(input, operation);
        if (result.state === "uncertain") break;
      }
      operation = {
        ...operation,
        state: operation.outcomes.every((outcome) => outcome.state === "confirmed")
          ? "completed"
          : "attention",
      };
      yield* store.saveOperation(input, operation);
      return operation;
    },
    lock.withPermits(1),
    Effect.uninterruptible,
  );
  return VoucherService.of({
    catalog: Effect.fn("VoucherService.catalog")((router: RouterProfile) =>
      store.catalog(RouterApi.routerKey(router)),
    ),
    discover: Effect.fn("VoucherService.refreshCatalog")(discover, lock.withPermits(1)),
    list: store.list,
    sync,
    details,
    mutate,
    history: store.history,
  });
});
export const layer = Layer.effect(VoucherService, make);
