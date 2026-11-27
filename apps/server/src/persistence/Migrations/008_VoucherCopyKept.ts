import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A snapshot a later copy did not read keeps the times of the copy that wrote it. NULL means
  // the customer's latest copy wrote it.
  yield* sql`ALTER TABLE voucher_db_snapshots ADD COLUMN kept_captured_at TEXT`;
  yield* sql`ALTER TABLE voucher_db_snapshots ADD COLUMN kept_copied_until TEXT`;
  yield* sql`ALTER TABLE voucher_db_snapshots ADD COLUMN kept_busy INTEGER`;
  // Per customer: vouchers the latest copy kept from earlier ones, and why it did not read them.
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN kept INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN kept_since TEXT`;
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN reasons TEXT NOT NULL DEFAULT '[]'`;
});
