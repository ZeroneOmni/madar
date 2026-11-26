import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // A copy taken while User Manager wrote is "busy": its rows come from commits between the
  // download's start (captured_at) and the check after it (copied_until).
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN busy INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN copied_until TEXT`;
  yield* sql`ALTER TABLE voucher_db_routers ADD COLUMN accepted_busy INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE voucher_db_routers ADD COLUMN failure_detail TEXT`;
});
