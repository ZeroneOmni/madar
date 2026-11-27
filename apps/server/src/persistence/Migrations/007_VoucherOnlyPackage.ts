import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // "only-package": a router database copy showed the voucher's current package is the only one
  // it ever had, so its lifetime counters are the package's usage. SQLite cannot change a CHECK.
  yield* sql`CREATE TABLE voucher_baselines_next (
    router_key TEXT NOT NULL, customer TEXT NOT NULL, username TEXT NOT NULL,
    router_id TEXT NOT NULL, profile TEXT NOT NULL,
    source TEXT NOT NULL
      CHECK (source IN ('activation', 'new', 'profile-change', 'counter-reset', 'only-package')),
    activated_at TEXT, sessions_after TEXT,
    download INTEGER NOT NULL, upload INTEGER NOT NULL, uptime INTEGER NOT NULL,
    recorded_at TEXT NOT NULL, first_login_at TEXT, first_login_checked_through TEXT,
    first_login_attempted_at TEXT,
    PRIMARY KEY(router_key, customer, username)
  ) WITHOUT ROWID`;
  yield* sql`INSERT INTO voucher_baselines_next SELECT router_key, customer, username, router_id,
    profile, source, activated_at, sessions_after, download, upload, uptime, recorded_at,
    first_login_at, first_login_checked_through, first_login_attempted_at FROM voucher_baselines`;
  yield* sql`DROP TABLE voucher_baselines`;
  yield* sql`ALTER TABLE voucher_baselines_next RENAME TO voucher_baselines`;
  // What the last accepted copy did for each customer, for the result Madar reports after it.
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN unused INTEGER NOT NULL DEFAULT 0`;
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN changed INTEGER`;
  yield* sql`ALTER TABLE voucher_db_captures ADD COLUMN unknown INTEGER`;
});
