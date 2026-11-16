import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as Semaphore from "effect/Semaphore";
import {
  VoucherFailure,
  type RouterProfile,
  type Voucher,
  type VoucherCatalog,
  type VoucherScope,
  type VoucherQuery,
  type VoucherTarget,
  type VoucherDetails,
  type VoucherMutation,
  type VoucherOperation,
} from "@madar/contracts";
import * as RouterApi from "../routers/RouterApi.ts";
import * as VoucherStore from "./VoucherStore.ts";

const userMenu = "/tool/user-manager/user";
const fields =
  ".id,customer,username,disabled,actual-profile,shared-users,comment,upload-used,download-used,uptime-used,last-seen,active-sessions";
const toVoucher = (row: Readonly<Record<string, string>>, time: string): Voucher => ({
  id: row[".id"] ?? "",
  customer: row.customer ?? "",
  username: row.username ?? row.name ?? "",
  disabled: row.disabled === "true" || row.disabled === "yes",
  profile: row["actual-profile"] ?? "",
  sharedUsers: row["shared-users"] ?? "",
  comment: row.comment ?? "",
  upload: row["upload-used"] ?? "",
  download: row["download-used"] ?? "",
  uptime: row["uptime-used"] ?? "",
  lastSeen: row["last-seen"] ?? "",
  activeSessions: row["active-sessions"] ?? "",
  observedAt: time,
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
    readonly list: (
      query: VoucherQuery,
    ) => Effect.Effect<import("@madar/contracts").VoucherPage, VoucherFailure>;
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
  const lock = yield* Semaphore.make(1);
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const read = Effect.fn("VoucherService.read")(
    (scope: VoucherScope, owner: string, words: readonly string[]) =>
      api.execute(scope.router, owner, words).pipe(Effect.mapError(failure)),
  );
  const find = Effect.fn("VoucherService.find")(function* (
    scope: VoucherScope,
    owner: string,
    id: string,
  ) {
    const rows = yield* read(scope, owner, [
      `${userMenu}/print`,
      `=.proplist=${fields}`,
      `?.id=${id}`,
      `?customer=${scope.customer}`,
    ]);
    if (rows.length !== 1 || rows[0]![".id"] !== id || rows[0]!.customer !== scope.customer)
      return yield* new VoucherFailure({ reason: "not-found" });
    const voucher = toVoucher(rows[0]!, yield* now);
    yield* store.upsert(scope, voucher);
    return voucher;
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
      "=.proplist=name,owner,validity,starts-at,price",
    ]);
    const names = customers.map((row) => row.login ?? row.name ?? "").filter(Boolean);
    const time = yield* now;
    const catalog: VoucherCatalog = {
      customers: names,
      profiles: profiles
        .map((row) => ({
          name: row.name ?? "",
          owner: row.owner ?? "",
          validity: row.validity ?? "",
          startsAt: row["starts-at"] ?? "",
          price: row.price ?? "",
        }))
        .filter((profile) => profile.name),
      syncedAt: time,
    };
    yield* store.saveCatalog(RouterApi.routerKey(router), catalog);
    return catalog;
  });
  const sync = Effect.fn("VoucherService.sync")(function* (scope: VoucherScope, owner: string) {
    const catalog = yield* discover(scope.router, owner);
    if (!catalog.customers.includes(scope.customer))
      return yield* new VoucherFailure({ reason: "not-found" });
    const rows = yield* read(scope, owner, [
      `${userMenu}/print`,
      `=.proplist=${fields}`,
      `?customer=${scope.customer}`,
    ]);
    const time = yield* now;
    const vouchers = rows.map((row) => toVoucher(row, time));
    if (
      vouchers.some(
        (voucher) => !voucher.id || !voucher.username || voucher.customer !== scope.customer,
      )
    )
      return yield* new VoucherFailure({ reason: "protocol" });
    yield* store.replace(scope, vouchers, time);
    return catalog;
  }, lock.withPermits(1));
  const details = Effect.fn("VoucherService.details")(function* (
    target: VoucherTarget,
    owner: string,
  ) {
    const voucher = yield* find(target, owner, target.id);
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
      `?user=${voucher.username}`,
      `?customer=${target.customer}`,
    ]).pipe(
      Effect.map((rows) => ({ sessions: rows.slice(-100), sessionsAvailable: true })),
      Effect.catch(() => Effect.succeed({ sessions: [], sessionsAvailable: false })),
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
            yield* read(input, owner, [
              `${userMenu}/add`,
              `=customer=${input.customer}`,
              `=username=${item.username}`,
              `=password=${item.password}`,
              `=shared-users=${action.sharedUsers}`,
              `=comment=${action.comment}`,
            ]);
            written = true;
            const created = yield* read(input, owner, [
              `${userMenu}/print`,
              `=.proplist=${fields}`,
              `?username=${item.username}`,
              `?customer=${input.customer}`,
            ]);
            if (created.length !== 1 || !created[0]![".id"])
              return yield* new VoucherFailure({ reason: "protocol" });
            id = created[0]![".id"]!;
            yield* store.upsert(input, toVoucher(created[0]!, yield* now));
            if (action.profile)
              yield* read(input, owner, [
                `${userMenu}/create-and-activate-profile`,
                `=customer=${input.customer}`,
                `=profile=${action.profile}`,
                `=numbers=${id}`,
              ]);
          } else {
            yield* find(input, owner, id);
            if (action.kind === "edit") {
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
          }
          if (action.kind === "remove") yield* store.remove(input, id);
          else yield* find(input, owner, id);
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
