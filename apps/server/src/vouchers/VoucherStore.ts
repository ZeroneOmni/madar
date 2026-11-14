import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@madar/shared/nodeSqliteClient";
import {
  Voucher,
  VoucherCatalog,
  VoucherOperation,
  VoucherFailure,
  type VoucherQuery,
  type VoucherScope,
  type VoucherPage,
} from "@madar/contracts";
import { routerKey } from "../routers/RouterApi.ts";

const parseVoucher = Schema.decodeUnknownSync(Schema.fromJsonString(Voucher));
const parseCatalog = Schema.decodeUnknownSync(Schema.fromJsonString(VoucherCatalog));
const parseOperation = Schema.decodeUnknownSync(Schema.fromJsonString(VoucherOperation));
const encodeCatalog = Schema.encodeSync(Schema.fromJsonString(VoucherCatalog));
const encodeVoucher = Schema.encodeSync(Schema.fromJsonString(Voucher));
const encodeOperation = Schema.encodeSync(Schema.fromJsonString(VoucherOperation));
const emptyCatalog: VoucherCatalog = { customers: [], profiles: [], syncedAt: null };
const storageError = () => new VoucherFailure({ reason: "storage" });
const isVoucherFailure = Schema.is(VoucherFailure);

export class VoucherStore extends Context.Service<
  VoucherStore,
  {
    readonly catalog: (key: string) => Effect.Effect<VoucherCatalog, VoucherFailure>;
    readonly saveCatalog: (
      key: string,
      catalog: VoucherCatalog,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly list: (query: VoucherQuery) => Effect.Effect<VoucherPage, VoucherFailure>;
    readonly replace: (
      scope: VoucherScope,
      vouchers: readonly Voucher[],
      time: string,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly upsert: (scope: VoucherScope, voucher: Voucher) => Effect.Effect<void, VoucherFailure>;
    readonly remove: (scope: VoucherScope, id: string) => Effect.Effect<void, VoucherFailure>;
    readonly operation: (
      scope: VoucherScope,
      requestId: string,
    ) => Effect.Effect<VoucherOperation | null, VoucherFailure>;
    readonly saveOperation: (
      scope: VoucherScope,
      operation: VoucherOperation,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly history: (
      scope: VoucherScope,
    ) => Effect.Effect<readonly VoucherOperation[], VoucherFailure>;
  }
>()("madar/vouchers/VoucherStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const catalog = Effect.fn("VoucherStore.catalog")(function* (key: string) {
    const rows = yield* sql<{
      data: string;
    }>`SELECT data FROM voucher_catalog WHERE router_key = ${key}`;
    return rows[0]
      ? yield* Effect.try({ try: () => parseCatalog(rows[0]!.data), catch: storageError })
      : emptyCatalog;
  }, Effect.mapError(storageError));
  const saveCatalog = Effect.fn("VoucherStore.saveCatalog")(function* (
    key: string,
    value: VoucherCatalog,
  ) {
    yield* sql`INSERT INTO voucher_catalog VALUES (${key}, ${encodeCatalog(value)}, ${value.syncedAt ?? ""}) ON CONFLICT(router_key) DO UPDATE SET data=excluded.data, synced_at=excluded.synced_at`;
  }, Effect.mapError(storageError));
  const row = (key: string, voucher: Voucher) => ({
    router_key: key,
    customer: voucher.customer,
    id: voucher.id,
    username: voucher.username,
    profile: voucher.profile,
    disabled: Number(voucher.disabled),
    comment: voucher.comment,
    data: encodeVoucher(voucher),
  });
  const upsert = Effect.fn("VoucherStore.upsert")(function* (
    scope: VoucherScope,
    voucher: Voucher,
  ) {
    yield* sql`INSERT OR REPLACE INTO vouchers ${sql.insert(row(routerKey(scope.router), voucher))}`;
  }, Effect.mapError(storageError));
  const replace = Effect.fn("VoucherStore.replace")(function* (
    scope: VoucherScope,
    vouchers: readonly Voucher[],
    time: string,
  ) {
    const key = routerKey(scope.router);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* sql<{
          id: string;
          data: string;
        }>`SELECT id, data FROM vouchers WHERE router_key=${key} AND customer=${scope.customer}`;
        const existing = new Map(previous.map((item) => [item.id, parseVoucher(item.data)]));
        const changed = vouchers.filter((voucher) => {
          const old = existing.get(voucher.id);
          existing.delete(voucher.id);
          return (
            !old || encodeVoucher({ ...voucher, observedAt: old.observedAt }) !== encodeVoucher(old)
          );
        });
        const removed = [...existing.keys()];
        for (let start = 0; start < removed.length; start += 100) {
          yield* sql`DELETE FROM vouchers WHERE router_key=${key} AND customer=${scope.customer} AND ${sql.in("id", removed.slice(start, start + 100))}`;
        }
        for (let start = 0; start < changed.length; start += 100) {
          yield* sql`INSERT OR REPLACE INTO vouchers ${sql.insert(changed.slice(start, start + 100).map((voucher) => row(key, voucher)))}`;
        }
        yield* sql`INSERT OR REPLACE INTO voucher_sync VALUES (${key}, ${scope.customer}, ${time})`;
      }),
    );
  }, Effect.mapError(storageError));
  const list = Effect.fn("VoucherStore.list")(
    function* (query: VoucherQuery) {
      const key = routerKey(query.router);
      const where = ["router_key = ?", "customer = ?"];
      const values: (string | number)[] = [key, query.customer];
      if (query.search) {
        where.push("instr(lower(username || ' ' || comment), lower(?)) > 0");
        values.push(query.search);
      }
      if (query.profile) {
        where.push("profile = ?");
        values.push(query.profile);
      }
      if (query.status === "enabled") where.push("disabled=0");
      if (query.status === "disabled") where.push("disabled=1");
      if (query.status === "online")
        where.push("CAST(json_extract(data, '$.activeSessions') AS INTEGER)>0");
      if (query.status === "unassigned") where.push("profile=''");
      const condition = where.join(" AND ");
      const order =
        query.sort === "profile"
          ? "profile"
          : query.sort === "lastSeen"
            ? "json_extract(data, '$.lastSeen')"
            : "username";
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const count = yield* sql.unsafe<{ total: number }>(
            `SELECT COUNT(*) AS total FROM vouchers WHERE ${condition}`,
            values,
          );
          const rows = yield* sql.unsafe<{ data: string }>(
            `SELECT data FROM vouchers WHERE ${condition} ORDER BY ${order} ${query.descending ? "DESC" : "ASC"}, id LIMIT ? OFFSET ?`,
            [...values, query.limit, query.offset],
          );
          const sync = yield* sql<{
            synced_at: string;
          }>`SELECT synced_at FROM voucher_sync WHERE router_key=${key} AND customer=${query.customer}`;
          const items = yield* Effect.try({
            try: () =>
              rows.map((row) => {
                const voucher = parseVoucher(row.data);
                const time = sync[0]?.synced_at;
                return time && time > voucher.observedAt
                  ? { ...voucher, observedAt: time }
                  : voucher;
              }),
            catch: storageError,
          });
          return {
            items,
            total: count[0]?.total ?? 0,
            syncedAt: sync[0]?.synced_at ?? null,
            complete: sync.length > 0,
          };
        }),
      );
      return result;
    },
    NodeSqliteClient.readOnly,
    Effect.mapError(storageError),
  );
  const remove = Effect.fn("VoucherStore.remove")(function* (scope: VoucherScope, id: string) {
    yield* sql`DELETE FROM vouchers WHERE router_key=${routerKey(scope.router)} AND customer=${scope.customer} AND id=${id}`;
  }, Effect.mapError(storageError));
  const operation = Effect.fn("VoucherStore.operation")(
    function* (scope: VoucherScope, requestId: string) {
      const rows = yield* sql<{
        data: string;
        router_key: string;
        customer: string;
      }>`SELECT data, router_key, customer FROM voucher_operations WHERE request_id=${requestId}`;
      if (!rows[0]) return null;
      if (rows[0].router_key !== routerKey(scope.router) || rows[0].customer !== scope.customer)
        return yield* new VoucherFailure({ reason: "conflict" });
      return yield* Effect.try({ try: () => parseOperation(rows[0]!.data), catch: storageError });
    },
    Effect.mapError((error) => (isVoucherFailure(error) ? error : storageError())),
  );
  const saveOperation = Effect.fn("VoucherStore.saveOperation")(function* (
    scope: VoucherScope,
    operation: VoucherOperation,
  ) {
    yield* sql`INSERT INTO voucher_operations VALUES (${operation.requestId}, ${routerKey(scope.router)}, ${scope.customer}, ${operation.createdAt}, ${encodeOperation(operation)}) ON CONFLICT(request_id) DO UPDATE SET data=excluded.data`;
  }, Effect.mapError(storageError));
  const history = Effect.fn("VoucherStore.history")(function* (scope: VoucherScope) {
    const rows = yield* sql<{
      data: string;
    }>`SELECT data FROM voucher_operations WHERE router_key=${routerKey(scope.router)} AND customer=${scope.customer} ORDER BY created_at DESC LIMIT 30`;
    return yield* Effect.try({
      try: () => rows.map((row) => parseOperation(row.data)),
      catch: storageError,
    });
  }, Effect.mapError(storageError));
  return VoucherStore.of({
    catalog,
    saveCatalog,
    list,
    replace,
    upsert,
    remove,
    operation,
    saveOperation,
    history,
  });
});
export const layer = Layer.effect(VoucherStore, make);
