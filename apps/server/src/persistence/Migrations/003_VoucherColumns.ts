import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import {
  naturalKey,
  parseBytes,
  parseCount,
  parseDuration,
  parsePrice,
  parseRouterDateTime,
  parseSharedUsers,
} from "../../vouchers/routerValues.ts";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const parseJson = (value: string): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Router cache: one typed column per allowlisted User Manager field. Dates are router-local text.
  yield* sql`CREATE TABLE voucher_cache (
    router_key TEXT NOT NULL, customer TEXT NOT NULL, id TEXT NOT NULL,
    username TEXT NOT NULL, username_key TEXT NOT NULL, comment TEXT NOT NULL,
    disabled INTEGER NOT NULL, active INTEGER NOT NULL, incomplete INTEGER NOT NULL,
    profile TEXT NOT NULL,
    shared_users INTEGER, shared_users_unlimited INTEGER NOT NULL,
    download_used INTEGER, upload_used INTEGER, uptime_used INTEGER,
    last_seen TEXT, last_seen_never INTEGER NOT NULL,
    active_sessions INTEGER, registration_date TEXT,
    caller_id TEXT NOT NULL, caller_id_bind INTEGER NOT NULL,
    ip_address TEXT NOT NULL, ipv6_dns TEXT NOT NULL, ipv6_prefix TEXT NOT NULL,
    wireless_enc_algo TEXT NOT NULL,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, phone TEXT NOT NULL,
    email TEXT NOT NULL, location TEXT NOT NULL,
    observed_at TEXT NOT NULL, first_seen_at TEXT NOT NULL, changed_at TEXT NOT NULL,
    PRIMARY KEY(router_key, customer, id),
    CHECK (shared_users_unlimited = 0 OR shared_users IS NULL),
    CHECK (last_seen_never = 0 OR last_seen IS NULL)
  )`;
  yield* sql`CREATE INDEX voucher_cache_username ON voucher_cache(router_key, customer, username_key, id)`;
  yield* sql`CREATE INDEX voucher_cache_profile ON voucher_cache(router_key, customer, profile, username_key)`;
  // Default-visible columns sort ascending on the first header click. Each expression must match
  // VoucherStore's sort key exactly, including the NULL-last term, or SQLite ignores the index.
  for (const [name, key] of [
    ["state", "CASE WHEN disabled THEN 2 WHEN active_sessions > 0 THEN 0 ELSE 1 END"],
    ["profile_sort", "NULLIF(lower(profile), '')"],
    ["data_used", "download_used + upload_used"],
    ["uptime", "uptime_used"],
    ["last_seen", "last_seen"],
  ])
    yield* sql.unsafe(
      `CREATE INDEX voucher_cache_${name} ON voucher_cache(router_key, customer, (${key}) IS NULL, ${key}, username_key, id)`,
    );

  yield* sql`CREATE TABLE voucher_routers (
    router_key TEXT PRIMARY KEY, synced_at TEXT NOT NULL,
    limits_synced INTEGER NOT NULL, clock_offset INTEGER
  )`;
  yield* sql`CREATE TABLE voucher_customers (
    router_key TEXT NOT NULL, login TEXT NOT NULL, PRIMARY KEY(router_key, login)
  ) WITHOUT ROWID`;
  yield* sql`CREATE TABLE voucher_profiles (
    router_key TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL,
    name_for_users TEXT NOT NULL, validity INTEGER, starts_at TEXT NOT NULL, price REAL,
    override_shared_users INTEGER, override_shared_users_unlimited INTEGER NOT NULL,
    PRIMARY KEY(router_key, name)
  ) WITHOUT ROWID`;
  yield* sql`CREATE TABLE voucher_limitations (
    router_key TEXT NOT NULL, name TEXT NOT NULL, owner TEXT NOT NULL,
    transfer_limit INTEGER, download_limit INTEGER, upload_limit INTEGER, uptime_limit INTEGER,
    PRIMARY KEY(router_key, name)
  ) WITHOUT ROWID`;
  yield* sql`CREATE TABLE voucher_profile_limitations (
    router_key TEXT NOT NULL, profile TEXT NOT NULL, limitation TEXT NOT NULL,
    from_time INTEGER, till_time INTEGER, weekdays INTEGER
  )`;
  yield* sql`CREATE INDEX voucher_profile_limitations_profile ON voucher_profile_limitations(router_key, profile)`;

  // Madar-owned data. Keyed by username with the last known router .id, so a reused username
  // never inherits another voucher's history.
  yield* sql`CREATE TABLE voucher_baselines (
    router_key TEXT NOT NULL, customer TEXT NOT NULL, username TEXT NOT NULL,
    router_id TEXT NOT NULL, profile TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('activation', 'new', 'profile-change', 'counter-reset')),
    activated_at TEXT, download INTEGER NOT NULL, upload INTEGER NOT NULL, uptime INTEGER NOT NULL,
    recorded_at TEXT NOT NULL, first_login_at TEXT, first_login_checked_through TEXT,
    PRIMARY KEY(router_key, customer, username)
  ) WITHOUT ROWID`;
  yield* sql`CREATE TABLE voucher_batches (
    id INTEGER PRIMARY KEY, router_key TEXT NOT NULL, customer TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, requested INTEGER NOT NULL,
    profile TEXT NOT NULL, comment TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE voucher_batch_members (
    batch_id INTEGER NOT NULL REFERENCES voucher_batches(id) ON DELETE CASCADE,
    router_key TEXT NOT NULL, customer TEXT NOT NULL, username TEXT NOT NULL,
    router_id TEXT NOT NULL,
    PRIMARY KEY(router_key, customer, username, batch_id)
  ) WITHOUT ROWID`;
  yield* sql`CREATE INDEX voucher_batch_members_batch ON voucher_batch_members(batch_id)`;

  const vouchers = yield* sql<{
    router_key: string;
    customer: string;
    id: string;
    username: string;
    profile: string;
    disabled: number;
    comment: string;
    data: string;
  }>`SELECT router_key, customer, id, username, profile, disabled, comment, data FROM vouchers`;
  const rows = vouchers.map((row) => {
    const data = parseJson(row.data);
    const lastSeen = text(data.lastSeen);
    const shared = parseSharedUsers(text(data.sharedUsers));
    const observed = text(data.observedAt);
    return {
      router_key: row.router_key,
      customer: row.customer,
      id: row.id,
      username: row.username,
      username_key: naturalKey(row.username),
      comment: row.comment,
      disabled: row.disabled,
      active: 0,
      incomplete: 0,
      profile: row.profile,
      shared_users: shared.count,
      shared_users_unlimited: Number(shared.unlimited),
      download_used: parseBytes(text(data.download)),
      upload_used: parseBytes(text(data.upload)),
      uptime_used: parseDuration(text(data.uptime)),
      last_seen: lastSeen === "never" ? null : parseRouterDateTime(lastSeen),
      last_seen_never: Number(lastSeen === "never"),
      active_sessions: parseCount(text(data.activeSessions)),
      registration_date: null,
      caller_id: "",
      caller_id_bind: 0,
      ip_address: "",
      ipv6_dns: "",
      ipv6_prefix: "",
      wireless_enc_algo: "",
      first_name: "",
      last_name: "",
      phone: "",
      email: "",
      location: "",
      observed_at: observed,
      first_seen_at: observed,
      changed_at: observed,
    };
  });
  for (let start = 0; start < rows.length; start += 100)
    yield* sql`INSERT INTO voucher_cache ${sql.insert(rows.slice(start, start + 100))}`;

  const catalogs = yield* sql<{
    router_key: string;
    data: string;
    synced_at: string;
  }>`SELECT router_key, data, synced_at FROM voucher_catalog`;
  for (const catalog of catalogs) {
    const data = parseJson(catalog.data);
    // Limitations were never cached before this migration, so remaining stays unknown until a refresh.
    yield* sql`INSERT INTO voucher_routers VALUES (${catalog.router_key}, ${catalog.synced_at}, 0, NULL)`;
    for (const login of Array.isArray(data.customers) ? data.customers : [])
      if (typeof login === "string" && login)
        yield* sql`INSERT OR IGNORE INTO voucher_customers VALUES (${catalog.router_key}, ${login})`;
    for (const item of Array.isArray(data.profiles) ? data.profiles : []) {
      const profile =
        typeof item === "object" && item !== null ? (item as Record<string, unknown>) : {};
      if (!text(profile.name)) continue;
      yield* sql`INSERT OR IGNORE INTO voucher_profiles ${sql.insert({
        router_key: catalog.router_key,
        name: text(profile.name),
        owner: text(profile.owner),
        name_for_users: "",
        validity: parseDuration(text(profile.validity)),
        starts_at: text(profile.startsAt),
        price: parsePrice(text(profile.price)),
        override_shared_users: null,
        override_shared_users_unlimited: 0,
      })}`;
    }
  }
  yield* sql`DROP TABLE vouchers`;
  yield* sql`DROP TABLE voucher_catalog`;
});
