import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE voucher_catalog (router_key TEXT PRIMARY KEY, data TEXT NOT NULL, synced_at TEXT NOT NULL)`;
  yield* sql`CREATE TABLE voucher_sync (router_key TEXT NOT NULL, customer TEXT NOT NULL, synced_at TEXT NOT NULL, PRIMARY KEY(router_key, customer))`;
  yield* sql`CREATE TABLE vouchers (
    router_key TEXT NOT NULL, customer TEXT NOT NULL, id TEXT NOT NULL,
    username TEXT NOT NULL COLLATE NOCASE, profile TEXT NOT NULL, disabled INTEGER NOT NULL,
    comment TEXT NOT NULL, data TEXT NOT NULL,
    PRIMARY KEY(router_key, customer, id)
  )`;
  yield* sql`CREATE INDEX vouchers_customer_username ON vouchers(router_key, customer, username, id)`;
  yield* sql`CREATE INDEX vouchers_customer_profile ON vouchers(router_key, customer, profile, username)`;
  yield* sql`CREATE TABLE voucher_operations (
    request_id TEXT PRIMARY KEY, router_key TEXT NOT NULL, customer TEXT NOT NULL,
    created_at TEXT NOT NULL, data TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX voucher_operations_scope ON voucher_operations(router_key, customer, created_at DESC)`;
});
