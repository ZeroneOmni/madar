import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Router database copies, kept apart from the API cache. Router-local times are naive text;
  // Madar times are ISO. One row per router: copy state that survives restarts.
  yield* sql`CREATE TABLE voucher_db_routers (
    router_key TEXT PRIMARY KEY,
    last_attempt_at TEXT, last_automatic_at TEXT, last_outcome TEXT, accepted_at TEXT,
    fingerprint TEXT,
    failure_stage TEXT, failure_reason TEXT, failed_at TEXT,
    paused INTEGER NOT NULL DEFAULT 0, retry_at TEXT,
    host_key TEXT, offered_host_key TEXT
  ) WITHOUT ROWID`;
  // Per customer: the last accepted copy and the outcome of the last attempt.
  yield* sql`CREATE TABLE voucher_db_captures (
    router_key TEXT NOT NULL, customer TEXT NOT NULL,
    captured_at TEXT, fingerprint TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'unchanged', 'failed', 'cancelled')),
    checked_at TEXT NOT NULL, error_stage TEXT, error_reason TEXT,
    matched INTEGER NOT NULL DEFAULT 0, skipped INTEGER NOT NULL DEFAULT 0,
    id_confirmed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(router_key, customer)
  ) WITHOUT ROWID`;
  // The current package assignment of each matched voucher, as of the customer's capture.
  yield* sql`CREATE TABLE voucher_db_snapshots (
    router_key TEXT NOT NULL, customer TEXT NOT NULL, api_id TEXT NOT NULL,
    username TEXT NOT NULL, db_user_id INTEGER NOT NULL, db_assignment_id INTEGER NOT NULL,
    profile TEXT NOT NULL,
    download INTEGER NOT NULL, upload INTEGER NOT NULL, uptime INTEGER NOT NULL,
    life_download INTEGER NOT NULL, life_upload INTEGER NOT NULL, life_uptime INTEGER NOT NULL,
    started_at TEXT, ends_at TEXT, state INTEGER,
    quota_signature TEXT NOT NULL, capture_ref TEXT NOT NULL,
    PRIMARY KEY(router_key, customer, api_id)
  ) WITHOUT ROWID`;
  yield* sql`CREATE TABLE voucher_db_assignments (
    router_key TEXT NOT NULL, customer TEXT NOT NULL, api_id TEXT NOT NULL,
    db_assignment_id INTEGER NOT NULL, profile TEXT NOT NULL,
    assigned_at TEXT, started_at TEXT, ends_at TEXT, state INTEGER, price REAL,
    download INTEGER NOT NULL, upload INTEGER NOT NULL, uptime INTEGER NOT NULL,
    current INTEGER NOT NULL,
    PRIMARY KEY(router_key, customer, api_id, db_assignment_id)
  ) WITHOUT ROWID`;
});
