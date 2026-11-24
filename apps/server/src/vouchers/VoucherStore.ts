import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@madar/shared/nodeSqliteClient";
import {
  VOUCHER_NEARLY_ENDED,
  VoucherOperation,
  VoucherFailure,
  type Voucher,
  type VoucherCatalog,
  type VoucherQuery,
  type VoucherRow,
  type VoucherScope,
  type VoucherPage,
  type VoucherSortField,
} from "@madar/contracts";
import { routerKey } from "../routers/RouterApi.ts";
import { epochToNaive, naiveToEpoch, naturalKey } from "./routerValues.ts";

const parseOperation = Schema.decodeUnknownSync(Schema.fromJsonString(VoucherOperation));
const encodeOperation = Schema.encodeSync(Schema.fromJsonString(VoucherOperation));
const storageError = () => new VoucherFailure({ reason: "storage" });
const isVoucherFailure = Schema.is(VoucherFailure);

/** Session reads per refresh that look for a first login after activation. */
export const FIRST_LOGIN_READS_PER_REFRESH = 10;

/** A voucher as read from the router; Madar observation times are added by the store. */
export type RouterVoucher = Omit<Voucher, "firstSeenAt" | "changedAt">;
export interface CatalogInput {
  readonly customers: readonly string[];
  readonly profiles: readonly {
    name: string;
    owner: string;
    nameForUsers: string;
    validity: number | null;
    startsAt: string;
    price: number | null;
    overrideSharedUsers: number | "unlimited" | null;
  }[];
  readonly limitations: readonly {
    name: string;
    owner: string;
    transfer: number | null;
    download: number | null;
    upload: number | null;
    uptime: number | null;
  }[];
  readonly profileLimitations: readonly {
    profile: string;
    limitation: string;
    fromTime: number | null;
    tillTime: number | null;
    weekdays: number | null;
  }[];
  readonly syncedAt: string;
  readonly clockOffset: number | null;
}
export interface FirstLoginCandidate {
  readonly username: string;
  readonly routerId: string;
  readonly activatedAt: string | null;
  readonly lastSeen: string;
}

const routerColumns = [
  "username",
  "username_key",
  "comment",
  "disabled",
  "active",
  "incomplete",
  "profile",
  "shared_users",
  "shared_users_unlimited",
  "download_used",
  "upload_used",
  "uptime_used",
  "last_seen",
  "last_seen_never",
  "active_sessions",
  "registration_date",
  "caller_id",
  "caller_id_bind",
  "ip_address",
  "ipv6_dns",
  "ipv6_prefix",
  "wireless_enc_algo",
  "first_name",
  "last_name",
  "phone",
  "email",
  "location",
] as const;
type RouterColumns = Record<(typeof routerColumns)[number], string | number | null>;
const toColumns = (voucher: RouterVoucher): RouterColumns => ({
  username: voucher.username,
  username_key: naturalKey(voucher.username),
  comment: voucher.comment,
  disabled: Number(voucher.disabled),
  active: Number(voucher.active),
  incomplete: Number(voucher.incomplete),
  profile: voucher.profile,
  shared_users: typeof voucher.sharedUsers === "number" ? voucher.sharedUsers : null,
  shared_users_unlimited: Number(voucher.sharedUsers === "unlimited"),
  download_used: voucher.download,
  upload_used: voucher.upload,
  uptime_used: voucher.uptime,
  last_seen: voucher.lastSeen === "never" ? null : voucher.lastSeen,
  last_seen_never: Number(voucher.lastSeen === "never"),
  active_sessions: voucher.activeSessions,
  registration_date: voucher.registrationDate,
  caller_id: voucher.callerId,
  caller_id_bind: Number(voucher.callerIdBind),
  ip_address: voucher.ipAddress,
  ipv6_dns: voucher.ipv6Dns,
  ipv6_prefix: voucher.ipv6Prefix,
  wireless_enc_algo: voucher.wirelessEncryption,
  first_name: voucher.firstName,
  last_name: voucher.lastName,
  phone: voucher.phone,
  email: voucher.email,
  location: voucher.location,
});
const signature = (columns: Readonly<Record<string, unknown>>) =>
  JSON.stringify(routerColumns.map((column) => columns[column] ?? null));
const routerColumnList = routerColumns.join(", ");
const upsertConflict = `ON CONFLICT(router_key, customer, id) DO UPDATE SET ${routerColumns
  .map((column) => `${column}=excluded.${column}`)
  .join(", ")}, observed_at=excluded.observed_at, changed_at=excluded.changed_at`;

interface Baseline {
  username: string;
  router_id: string;
  profile: string;
  source: string;
  activated_at: string | null;
  download: number;
  upload: number;
  uptime: number;
}
type Previous = RouterColumns & { id: string };
const unused = (voucher: RouterVoucher) =>
  voucher.lastSeen === "never" &&
  voucher.download === 0 &&
  voucher.upload === 0 &&
  (voucher.uptime ?? 0) === 0;

/**
 * Remaining data and validity, computed from the typed cache, the profile catalog and Madar's
 * baselines. This is the only implementation; display, filters and sorting all read it.
 * Parameters: router key, customer, router-local "now" in epoch seconds (or NULL), router key,
 * then `ids` voucher ids when the rows are limited to a page.
 */
const rowsSql = (ids: number) => `
WITH params AS (
  SELECT ? AS router_key, ? AS customer, ? AS now,
    COALESCE((SELECT limits_synced FROM voucher_routers WHERE router_key = ?), 0) AS limits_synced
),
quota AS (
  SELECT p.name, p.validity, p.starts_at, p.price,
    MIN(NULLIF(l.transfer_limit, 0)) AS q_transfer,
    MIN(NULLIF(l.download_limit, 0)) AS q_download,
    MIN(NULLIF(l.upload_limit, 0)) AS q_upload,
    MIN(NULLIF(l.uptime_limit, 0)) AS q_uptime,
    MAX(CASE
      WHEN pl.profile IS NULL THEN 0
      WHEN l.name IS NULL THEN 1
      WHEN l.transfer_limit IS NULL OR l.download_limit IS NULL
        OR l.upload_limit IS NULL OR l.uptime_limit IS NULL THEN 1
      WHEN (l.transfer_limit + l.download_limit + l.upload_limit + l.uptime_limit) > 0
        AND (COALESCE(pl.from_time, 1) > 0 OR COALESCE(pl.till_time, 0) < 86399
          OR COALESCE(pl.weekdays, 0) != 127) THEN 1
      ELSE 0 END) AS q_unclear
  FROM voucher_profiles p JOIN params ON p.router_key = params.router_key
  LEFT JOIN voucher_profile_limitations pl ON pl.router_key = p.router_key AND pl.profile = p.name
  LEFT JOIN voucher_limitations l ON l.router_key = pl.router_key AND l.name = pl.limitation
  GROUP BY p.name
),
joined AS (
  SELECT v.*, params.now, params.limits_synced,
    q.name IS NOT NULL AS q_known, q.validity AS q_validity, q.starts_at AS q_starts_at,
    q.price AS q_price, q.q_transfer, q.q_download, q.q_upload, q.q_uptime, q.q_unclear,
    b.source AS b_source, b.activated_at AS b_activated_at, b.download AS b_download,
    b.upload AS b_upload, b.uptime AS b_uptime, b.first_login_at,
    b.first_login_checked_through,
    bt.id AS batch_id, bt.created_at AS batch_created_at, bt.requested AS batch_requested,
    bt.profile AS batch_profile, bt.comment AS batch_comment,
    (SELECT COUNT(*) FROM voucher_batch_members c WHERE c.batch_id = bt.id) AS batch_created
  FROM voucher_cache v ${ids ? "" : "NOT INDEXED"}
  JOIN params ON v.router_key = params.router_key AND v.customer = params.customer
    ${ids ? `AND v.id IN (${Array.from({ length: ids }, () => "?").join(", ")})` : ""}
  LEFT JOIN quota q ON q.name = v.profile
  LEFT JOIN voucher_baselines b ON b.router_key = v.router_key AND b.customer = v.customer
    AND b.username = v.username AND b.router_id = v.id AND b.profile = v.profile
  LEFT JOIN voucher_batch_members m ON m.router_key = v.router_key AND m.customer = v.customer
    AND m.username = v.username AND m.router_id = v.id
  LEFT JOIN voucher_batches bt ON bt.id = m.batch_id
),
measured AS (
  SELECT *,
    q_transfer IS NOT NULL OR q_download IS NOT NULL OR q_upload IS NOT NULL
      OR q_uptime IS NOT NULL AS has_quota,
    max(0, q_transfer - max(0, (download_used + upload_used) - (b_download + b_upload))) AS left_transfer,
    max(0, q_download - max(0, download_used - b_download)) AS left_download,
    max(0, q_upload - max(0, upload_used - b_upload)) AS left_upload,
    max(0, q_uptime - max(0, uptime_used - b_uptime)) AS left_uptime,
    CASE WHEN q_validity > 0 THEN
      CASE q_starts_at WHEN 'now' THEN b_activated_at WHEN 'logon' THEN first_login_at END
    END AS valid_from,
    q_validity > 0 AND q_starts_at = 'logon' AND first_login_at IS NULL AND (
      last_seen_never = 1
      OR (b_activated_at IS NOT NULL AND last_seen < b_activated_at)
      OR (first_login_checked_through IS NOT NULL AND last_seen <= first_login_checked_through)
    ) AS not_started
  FROM joined
),
reasoned AS (
  SELECT *,
    CASE
      WHEN profile = '' THEN ''
      WHEN NOT q_known OR NOT limits_synced THEN 'catalog'
      WHEN q_unclear OR q_validity IS NULL
        OR (q_validity > 0 AND q_starts_at NOT IN ('now', 'logon')) THEN 'limits'
      WHEN NOT has_quota AND q_validity = 0 THEN ''
      WHEN b_source IS NULL THEN 'baseline'
      WHEN has_quota AND (download_used IS NULL OR upload_used IS NULL
        OR (q_uptime IS NOT NULL AND uptime_used IS NULL)) THEN 'counters'
      WHEN q_validity > 0 AND q_starts_at = 'now' AND b_activated_at IS NULL THEN 'activation'
      WHEN q_validity > 0 AND valid_from IS NULL AND NOT not_started THEN 'first-login'
      WHEN q_validity > 0 AND valid_from IS NOT NULL AND now IS NULL THEN 'clock'
      ELSE '' END AS rem_reason,
    NULLIF(min(
      COALESCE(left_transfer * 1.0 / q_transfer, 9), COALESCE(left_download * 1.0 / q_download, 9),
      COALESCE(left_upload * 1.0 / q_upload, 9), COALESCE(left_uptime * 1.0 / q_uptime, 9)
    ), 9) AS data_ratio,
    CASE WHEN valid_from IS NOT NULL THEN max(0, unixepoch(valid_from) + q_validity - now) END AS time_left
  FROM measured
),
ranked AS (
  SELECT *,
    CASE
      WHEN profile = '' OR rem_reason != '' THEN NULL
      WHEN NOT has_quota AND q_validity = 0 THEN 2
      ELSE min(COALESCE(data_ratio, 1), CASE WHEN not_started THEN 1
        ELSE COALESCE(time_left * 1.0 / q_validity, 1) END)
    END AS rem_key,
    CASE
      WHEN time_left IS NOT NULL AND time_left * 1.0 / q_validity < COALESCE(data_ratio, 9) THEN 'validity'
      WHEN data_ratio IS NULL THEN CASE WHEN q_validity > 0 THEN 'validity' ELSE '' END
      WHEN left_transfer * 1.0 / q_transfer = data_ratio THEN 'transfer'
      WHEN left_download * 1.0 / q_download = data_ratio THEN 'download'
      WHEN left_upload * 1.0 / q_upload = data_ratio THEN 'upload'
      ELSE 'uptime' END AS rem_kind
  FROM reasoned
)`;

const sortKeys: Record<VoucherSortField, string> = {
  username: "username_key",
  comment: "NULLIF(lower(comment), '')",
  state: "CASE WHEN disabled THEN 2 WHEN active_sessions > 0 THEN 0 ELSE 1 END",
  profile: "NULLIF(lower(profile), '')",
  remaining: "rem_key",
  dataUsed: "download_used + upload_used",
  uptime: "uptime_used",
  lastSeen: "last_seen",
  download: "download_used",
  upload: "upload_used",
  activeSessions: "active_sessions",
  created: "registration_date",
  price: "q_price",
  quota: "COALESCE(q_transfer, q_download, q_upload)",
  sharedUsers: "CASE WHEN shared_users_unlimited THEN 9e18 ELSE shared_users END",
  macLock: "NULLIF(lower(caller_id), '')",
  ipAddress: "NULLIF(ip_address, '')",
  ipv6Dns: "NULLIF(ipv6_dns, '')",
  ipv6Prefix: "NULLIF(ipv6_prefix, '')",
  wireless: "NULLIF(lower(wireless_enc_algo), '')",
  flags: "active * 2 + incomplete",
  firstName: "NULLIF(lower(first_name), '')",
  lastName: "NULLIF(lower(last_name), '')",
  phone: "NULLIF(phone, '')",
  email: "NULLIF(lower(email), '')",
  location: "NULLIF(lower(location), '')",
  firstSeen: "first_seen_at",
  changed: "changed_at",
  firstLogin: "first_login_at",
  batch: "batch_created_at",
};

/** Empty, never and unknown values are NULL and stay last in both directions. */
export function orderBy(sort: VoucherQuery["sort"]) {
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  const expression = sortKeys[sort.field];
  return sort.field === "username"
    ? `username_key ${direction}, id ${direction}`
    : `(${expression}) IS NULL, ${expression} ${direction}, username_key, id`;
}
const joinedSorts = new Set<VoucherSortField>([
  "remaining",
  "price",
  "quota",
  "firstLogin",
  "batch",
]);
const joinedStatuses = new Set<VoucherQuery["status"]>(["low", "ended", "unknown"]);
const statusFilters: Record<VoucherQuery["status"], string> = {
  all: "",
  enabled: "disabled = 0",
  disabled: "disabled = 1",
  online: "active_sessions > 0",
  unassigned: "profile = ''",
  low: `rem_key > 0 AND rem_key < 2 AND (data_ratio <= ${VOUCHER_NEARLY_ENDED.ratio} OR time_left <= ${VOUCHER_NEARLY_ENDED.seconds})`,
  ended: "rem_key = 0",
  unknown: "rem_reason != ''",
};

interface ListRow {
  readonly [column: string]: string | number | null;
}
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : null);
const bool = (value: unknown) => value === 1;
const toRow = (row: ListRow, syncedAt: string | undefined): VoucherRow => {
  const observedAt = str(row.observed_at);
  const reason = str(row.rem_reason) as VoucherRow["remaining"]["reason"];
  const kind = str(row.rem_kind) as VoucherRow["remaining"]["kind"];
  const key = num(row.rem_key);
  const state: VoucherRow["remaining"]["state"] =
    row.profile === ""
      ? "none"
      : reason
        ? "unknown"
        : key === 2
          ? "unlimited"
          : key === 0
            ? kind === "validity"
              ? "expired"
              : "used-up"
            : bool(row.not_started)
              ? "not-started"
              : kind === "validity"
                ? "ends"
                : "left";
  const amounts: Record<string, [unknown, unknown]> = {
    transfer: [row.left_transfer, row.q_transfer],
    download: [row.left_download, row.q_download],
    upload: [row.left_upload, row.q_upload],
    uptime: [row.left_uptime, row.q_uptime],
    validity: [row.not_started ? row.q_validity : row.time_left, row.q_validity],
  };
  const known = state !== "none" && state !== "unknown" && state !== "unlimited";
  const [amount, limit] = known ? (amounts[kind] ?? [null, null]) : [null, null];
  const validFrom = str(row.valid_from);
  const validity = num(row.q_validity);
  const endsAt =
    known && validFrom && validity ? epochToNaive(naiveToEpoch(validFrom) + validity * 1000) : null;
  const sharedUsers = bool(row.shared_users_unlimited) ? "unlimited" : num(row.shared_users);
  return {
    id: str(row.id),
    customer: str(row.customer),
    username: str(row.username),
    comment: str(row.comment),
    disabled: bool(row.disabled),
    active: bool(row.active),
    incomplete: bool(row.incomplete),
    profile: str(row.profile),
    sharedUsers,
    download: num(row.download_used),
    upload: num(row.upload_used),
    uptime: num(row.uptime_used),
    lastSeen: bool(row.last_seen_never) ? "never" : str(row.last_seen) || null,
    activeSessions: num(row.active_sessions),
    registrationDate: str(row.registration_date) || null,
    callerId: str(row.caller_id),
    callerIdBind: bool(row.caller_id_bind),
    ipAddress: str(row.ip_address),
    ipv6Dns: str(row.ipv6_dns),
    ipv6Prefix: str(row.ipv6_prefix),
    wirelessEncryption: str(row.wireless_enc_algo),
    firstName: str(row.first_name),
    lastName: str(row.last_name),
    phone: str(row.phone),
    email: str(row.email),
    location: str(row.location),
    observedAt: syncedAt && syncedAt > observedAt ? syncedAt : observedAt,
    firstSeenAt: str(row.first_seen_at),
    changedAt: str(row.changed_at),
    price: num(row.q_price),
    quota: {
      transfer: num(row.q_transfer),
      download: num(row.q_download),
      upload: num(row.q_upload),
      uptime: num(row.q_uptime),
    },
    validity,
    firstLoginAt: str(row.first_login_at) || null,
    batch:
      row.batch_id === null
        ? null
        : {
            id: num(row.batch_id) ?? 0,
            createdAt: str(row.batch_created_at),
            requested: num(row.batch_requested) ?? 0,
            created: num(row.batch_created) ?? 0,
            profile: str(row.batch_profile),
            comment: str(row.batch_comment),
          },
    remaining: {
      state,
      reason,
      kind: known ? kind : "",
      amount: num(amount),
      limit: num(limit),
      endsAt,
      basis:
        known || state === "unknown" ? (str(row.b_source) as VoucherRow["remaining"]["basis"]) : "",
    },
  };
};

export class VoucherStore extends Context.Service<
  VoucherStore,
  {
    readonly catalog: (key: string) => Effect.Effect<VoucherCatalog, VoucherFailure>;
    readonly saveCatalog: (
      key: string,
      catalog: CatalogInput,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly routerNow: (key: string) => Effect.Effect<number | null, VoucherFailure>;
    readonly list: (query: VoucherQuery) => Effect.Effect<VoucherPage, VoucherFailure>;
    readonly row: (
      scope: VoucherScope,
      id: string,
    ) => Effect.Effect<VoucherRow | null, VoucherFailure>;
    readonly replace: (
      scope: VoucherScope,
      vouchers: readonly RouterVoucher[],
      time: string,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly upsert: (
      scope: VoucherScope,
      voucher: RouterVoucher,
      activatedAt?: string | null,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly remove: (scope: VoucherScope, id: string) => Effect.Effect<void, VoucherFailure>;
    readonly firstLoginCandidates: (
      scope: VoucherScope,
      limit: number,
    ) => Effect.Effect<readonly FirstLoginCandidate[], VoucherFailure>;
    readonly saveFirstLogin: (
      scope: VoucherScope,
      candidate: FirstLoginCandidate,
      firstLoginAt: string | null,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly createBatch: (
      scope: VoucherScope,
      batch: {
        requestId: string;
        createdAt: string;
        requested: number;
        profile: string;
        comment: string;
      },
    ) => Effect.Effect<number, VoucherFailure>;
    readonly addBatchMember: (
      scope: VoucherScope,
      batchId: number,
      username: string,
      routerId: string,
    ) => Effect.Effect<void, VoucherFailure>;
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
  const nowSeconds = Clock.currentTimeMillis.pipe(Effect.map((ms) => Math.floor(ms / 1000)));
  const routerNowFor = Effect.fnUntraced(function* (key: string) {
    const rows = yield* sql<{
      clock_offset: number | null;
    }>`SELECT clock_offset FROM voucher_routers WHERE router_key = ${key}`;
    const offset = rows[0]?.clock_offset;
    return offset === null || offset === undefined ? null : (yield* nowSeconds) + offset;
  });

  const catalog = Effect.fn("VoucherStore.catalog")(function* (key: string) {
    const router = yield* sql<{
      synced_at: string;
    }>`SELECT synced_at FROM voucher_routers WHERE router_key = ${key}`;
    const customers = yield* sql<{
      login: string;
    }>`SELECT login FROM voucher_customers WHERE router_key = ${key} ORDER BY login`;
    const profiles = yield* sql<{
      name: string;
      owner: string;
      name_for_users: string;
      validity: number | null;
      starts_at: string;
      price: number | null;
      override_shared_users: number | null;
      override_shared_users_unlimited: number;
      q_transfer: number | null;
      q_download: number | null;
      q_upload: number | null;
      q_uptime: number | null;
    }>`SELECT p.*, MIN(NULLIF(l.transfer_limit, 0)) AS q_transfer,
        MIN(NULLIF(l.download_limit, 0)) AS q_download, MIN(NULLIF(l.upload_limit, 0)) AS q_upload,
        MIN(NULLIF(l.uptime_limit, 0)) AS q_uptime
      FROM voucher_profiles p
      LEFT JOIN voucher_profile_limitations pl ON pl.router_key = p.router_key AND pl.profile = p.name
      LEFT JOIN voucher_limitations l ON l.router_key = pl.router_key AND l.name = pl.limitation
      WHERE p.router_key = ${key} GROUP BY p.name ORDER BY p.name`;
    return {
      customers: customers.map((row) => row.login),
      profiles: profiles.map((row) => ({
        name: row.name,
        owner: row.owner,
        nameForUsers: row.name_for_users,
        validity: row.validity,
        startsAt: row.starts_at,
        price: row.price,
        overrideSharedUsers: row.override_shared_users_unlimited
          ? ("unlimited" as const)
          : row.override_shared_users,
        quota: {
          transfer: row.q_transfer,
          download: row.q_download,
          upload: row.q_upload,
          uptime: row.q_uptime,
        },
      })),
      syncedAt: router[0]?.synced_at ?? null,
    };
  }, Effect.mapError(storageError));

  const saveCatalog = Effect.fn("VoucherStore.saveCatalog")(function* (
    key: string,
    value: CatalogInput,
  ) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`INSERT INTO voucher_routers VALUES (${key}, ${value.syncedAt}, 1, ${value.clockOffset})
          ON CONFLICT(router_key) DO UPDATE SET synced_at = excluded.synced_at,
          limits_synced = 1, clock_offset = excluded.clock_offset`;
        for (const table of [
          "voucher_customers",
          "voucher_profiles",
          "voucher_limitations",
          "voucher_profile_limitations",
        ])
          yield* sql`DELETE FROM ${sql(table)} WHERE router_key = ${key}`;
        for (const login of new Set(value.customers))
          yield* sql`INSERT INTO voucher_customers VALUES (${key}, ${login})`;
        for (const profile of value.profiles)
          yield* sql`INSERT OR REPLACE INTO voucher_profiles ${sql.insert({
            router_key: key,
            name: profile.name,
            owner: profile.owner,
            name_for_users: profile.nameForUsers,
            validity: profile.validity,
            starts_at: profile.startsAt,
            price: profile.price,
            override_shared_users:
              typeof profile.overrideSharedUsers === "number" ? profile.overrideSharedUsers : null,
            override_shared_users_unlimited: Number(profile.overrideSharedUsers === "unlimited"),
          })}`;
        for (const limitation of value.limitations)
          yield* sql`INSERT OR REPLACE INTO voucher_limitations ${sql.insert({
            router_key: key,
            name: limitation.name,
            owner: limitation.owner,
            transfer_limit: limitation.transfer,
            download_limit: limitation.download,
            upload_limit: limitation.upload,
            uptime_limit: limitation.uptime,
          })}`;
        for (const link of value.profileLimitations)
          yield* sql`INSERT INTO voucher_profile_limitations ${sql.insert({
            router_key: key,
            profile: link.profile,
            limitation: link.limitation,
            from_time: link.fromTime,
            till_time: link.tillTime,
            weekdays: link.weekdays,
          })}`;
      }),
    );
  }, Effect.mapError(storageError));

  /** Writes router columns for changed rows and keeps baselines consistent with the new values. */
  const write = Effect.fnUntraced(function* (
    scope: VoucherScope,
    vouchers: readonly RouterVoucher[],
    previous: ReadonlyMap<string, Previous>,
    time: string,
    activations: ReadonlyMap<string, string | null>,
  ) {
    const key = routerKey(scope.router);
    const routerNow = yield* routerNowFor(key);
    const estimatedAt = routerNow === null ? null : epochToNaive(routerNow * 1000);
    const changed = vouchers.filter((voucher) => {
      const old = previous.get(voucher.id);
      return !old || signature(old) !== signature(toColumns(voucher));
    });
    // An activation that left router columns unchanged still records its baseline.
    const touched = vouchers.filter(
      (voucher) => activations.has(voucher.id) || changed.includes(voucher),
    );
    if (touched.length === 0) return;
    for (const voucher of changed) {
      const old = previous.get(voucher.id);
      if (old && old.username !== voucher.username) {
        // A rename keeps the voucher's Madar data; stale rows for the new name belong to another voucher.
        for (const table of ["voucher_baselines", "voucher_batch_members"]) {
          yield* sql`DELETE FROM ${sql(table)} WHERE router_key = ${key} AND customer = ${scope.customer}
            AND username = ${voucher.username} AND router_id != ${voucher.id}`;
          yield* sql`UPDATE ${sql(table)} SET username = ${voucher.username} WHERE router_key = ${key}
            AND customer = ${scope.customer} AND username = ${old.username} AND router_id = ${voucher.id}`;
        }
      }
    }
    for (let start = 0; start < changed.length; start += 100) {
      const rows = changed.slice(start, start + 100).map((voucher) => ({
        router_key: key,
        customer: scope.customer,
        id: voucher.id,
        ...toColumns(voucher),
        observed_at: voucher.observedAt,
        first_seen_at: time,
        changed_at: time,
      }));
      yield* sql`INSERT INTO voucher_cache ${sql.insert(rows)} ${sql.literal(upsertConflict)}`;
    }
    const baselines = new Map<string, Baseline>();
    for (let start = 0; start < touched.length; start += 100) {
      const names = touched.slice(start, start + 100).map((voucher) => voucher.username);
      for (const row of yield* sql<Baseline>`SELECT username, router_id, profile, source, activated_at,
          download, upload, uptime FROM voucher_baselines WHERE router_key = ${key}
          AND customer = ${scope.customer} AND ${sql.in("username", names)}`)
        baselines.set(row.username, row);
    }
    const recorded: Record<string, string | number | null>[] = [];
    for (const voucher of touched) {
      const old = previous.get(voucher.id);
      const stored = baselines.get(voucher.username);
      const baseline = stored?.router_id === voucher.id ? stored : undefined;
      const counters = {
        download: voucher.download ?? 0,
        upload: voucher.upload ?? 0,
        uptime: voucher.uptime ?? 0,
      };
      const parsed = voucher.download !== null && voucher.upload !== null;
      let next: { source: string; activatedAt: string | null; counters: typeof counters } | null =
        null;
      if (activations.has(voucher.id)) {
        if (parsed)
          next = {
            source: "activation",
            activatedAt: activations.get(voucher.id) ?? null,
            counters,
          };
      } else if (unused(voucher)) {
        if (!baseline || baseline.profile !== voucher.profile || baseline.source !== "new")
          next = { source: "new", activatedAt: null, counters };
      } else if (baseline && baseline.profile !== voucher.profile) {
        if (parsed) next = { source: "profile-change", activatedAt: estimatedAt, counters };
      } else if (!baseline && old && old.profile !== voucher.profile) {
        if (parsed) next = { source: "profile-change", activatedAt: estimatedAt, counters };
      } else if (
        baseline &&
        parsed &&
        (counters.download < baseline.download ||
          counters.upload < baseline.upload ||
          counters.uptime < baseline.uptime)
      ) {
        next = {
          source: "counter-reset",
          activatedAt: baseline.activated_at,
          counters: { download: 0, upload: 0, uptime: 0 },
        };
      }
      if (stored && stored.router_id !== voucher.id)
        yield* sql`DELETE FROM voucher_baselines WHERE router_key = ${key} AND customer = ${scope.customer}
          AND username = ${voucher.username}`;
      if (next)
        recorded.push({
          router_key: key,
          customer: scope.customer,
          username: voucher.username,
          router_id: voucher.id,
          profile: voucher.profile,
          source: next.source,
          activated_at: next.activatedAt,
          download: next.counters.download,
          upload: next.counters.upload,
          uptime: next.counters.uptime,
          recorded_at: time,
          first_login_at: null,
          first_login_checked_through: null,
        });
    }
    for (let start = 0; start < recorded.length; start += 100)
      yield* sql`INSERT OR REPLACE INTO voucher_baselines ${sql.insert(recorded.slice(start, start + 100))}`;
  });

  const readPrevious = Effect.fnUntraced(function* (scope: VoucherScope, ids?: readonly string[]) {
    const key = routerKey(scope.router);
    const rows = ids
      ? yield* sql<Previous>`SELECT id, ${sql.literal(routerColumnList)} FROM voucher_cache
          WHERE router_key = ${key} AND customer = ${scope.customer} AND ${sql.in("id", ids)}`
      : yield* sql<Previous>`SELECT id, ${sql.literal(routerColumnList)} FROM voucher_cache
          WHERE router_key = ${key} AND customer = ${scope.customer}`;
    return new Map(rows.map((row) => [row.id, row]));
  });

  const upsert = Effect.fn("VoucherStore.upsert")(function* (
    scope: VoucherScope,
    voucher: RouterVoucher,
    activatedAt?: string | null,
  ) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* readPrevious(scope, [voucher.id]);
        yield* write(
          scope,
          [voucher],
          previous,
          voucher.observedAt,
          activatedAt === undefined ? new Map() : new Map([[voucher.id, activatedAt]]),
        );
      }),
    );
  }, Effect.mapError(storageError));

  const deleteVouchers = Effect.fnUntraced(function* (
    scope: VoucherScope,
    removed: readonly Previous[],
  ) {
    const key = routerKey(scope.router);
    for (let start = 0; start < removed.length; start += 100) {
      const slice = removed.slice(start, start + 100);
      yield* sql`DELETE FROM voucher_cache WHERE router_key = ${key} AND customer = ${scope.customer}
        AND ${sql.in(
          "id",
          slice.map((row) => row.id),
        )}`;
      // Batch membership stays as history; the router_id join keeps it off a reused username.
      for (const row of slice)
        yield* sql`DELETE FROM voucher_baselines WHERE router_key = ${key} AND customer = ${scope.customer}
          AND username = ${row.username} AND router_id = ${row.id}`;
    }
  });

  const replace = Effect.fn("VoucherStore.replace")(function* (
    scope: VoucherScope,
    vouchers: readonly RouterVoucher[],
    time: string,
  ) {
    const key = routerKey(scope.router);
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* readPrevious(scope);
        const incoming = new Set(vouchers.map((voucher) => voucher.id));
        yield* deleteVouchers(
          scope,
          [...previous.values()].filter((row) => !incoming.has(row.id)),
        );
        yield* write(scope, vouchers, previous, time, new Map());
        yield* sql`INSERT OR REPLACE INTO voucher_sync VALUES (${key}, ${scope.customer}, ${time})`;
      }),
    );
  }, Effect.mapError(storageError));

  const remove = Effect.fn("VoucherStore.remove")(function* (scope: VoucherScope, id: string) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* readPrevious(scope, [id]);
        yield* deleteVouchers(scope, [...previous.values()]);
      }),
    );
  }, Effect.mapError(storageError));

  /** Full rows with remaining computed, for the given ids only. */
  const enrich = Effect.fnUntraced(function* (scope: VoucherScope, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const key = routerKey(scope.router);
    const now = yield* routerNowFor(key);
    const rows = yield* sql.unsafe<ListRow>(`${rowsSql(ids.length)} SELECT * FROM ranked`, [
      key,
      scope.customer,
      now,
      key,
      ...ids,
    ]);
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id): ListRow[] => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  });

  const list = Effect.fn("VoucherStore.list")(
    function* (query: VoucherQuery) {
      const key = routerKey(query.router);
      const where: string[] = [];
      const values: (string | number)[] = [];
      if (query.search) {
        where.push("instr(lower(username || ' ' || comment), lower(?)) > 0");
        values.push(query.search);
      }
      if (query.profile) {
        where.push("profile = ?");
        values.push(query.profile);
      }
      const status = statusFilters[query.status];
      if (status) where.push(status);
      const order = orderBy(query.sort);
      // Most sorts and filters read only cached router columns; those skip the remaining joins.
      // Whole-scope scans are NOT INDEXED: SQLite otherwise walks a sort index with a row lookup each.
      const cacheOnly = !joinedSorts.has(query.sort.field) && !joinedStatuses.has(query.status);
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const condition = where.length ? where.join(" AND ") : "1";
          const page = [query.limit, query.offset];
          let total: number;
          let ids: readonly string[];
          if (cacheOnly) {
            const scoped = `router_key = ? AND customer = ? AND ${condition}`;
            const count = yield* sql.unsafe<{ total: number }>(
              `SELECT COUNT(*) AS total FROM voucher_cache ${query.profile ? "" : "NOT INDEXED"} WHERE ${scoped}`,
              [key, query.customer, ...values],
            );
            const rows = yield* sql.unsafe<{ id: string }>(
              `SELECT id FROM voucher_cache WHERE ${scoped} ORDER BY ${order} LIMIT ? OFFSET ?`,
              [key, query.customer, ...values, ...page],
            );
            total = count[0]?.total ?? 0;
            ids = rows.map((row) => row.id);
          } else {
            const now = yield* routerNowFor(key);
            const params = [key, query.customer, now, key, ...values];
            // One pass: the window count avoids computing remaining twice over every row.
            const rows = yield* sql.unsafe<{ id: string; total: number }>(
              `${rowsSql(0)} SELECT id, COUNT(*) OVER () AS total FROM ranked WHERE ${condition}
                ORDER BY ${order} LIMIT ? OFFSET ?`,
              [...params, ...page],
            );
            total =
              rows[0]?.total ??
              (yield* sql.unsafe<{ total: number }>(
                `${rowsSql(0)} SELECT COUNT(*) AS total FROM ranked WHERE ${condition}`,
                params,
              ))[0]?.total ??
              0;
            ids = rows.map((row) => row.id);
          }
          const rows = yield* enrich(query, ids);
          const sync = yield* sql<{
            synced_at: string;
          }>`SELECT synced_at FROM voucher_sync WHERE router_key=${key} AND customer=${query.customer}`;
          return {
            items: rows.map((row) => toRow(row, sync[0]?.synced_at)),
            total,
            syncedAt: sync[0]?.synced_at ?? null,
            complete: sync.length > 0,
          };
        }),
      );
    },
    NodeSqliteClient.readOnly,
    Effect.mapError(storageError),
  );

  const row = Effect.fn("VoucherStore.row")(function* (scope: VoucherScope, id: string) {
    const [found] = yield* enrich(scope, [id]);
    return found ? toRow(found, undefined) : null;
  }, Effect.mapError(storageError));

  const firstLoginCandidates = Effect.fn("VoucherStore.firstLoginCandidates")(function* (
    scope: VoucherScope,
    limit: number,
  ) {
    const key = routerKey(scope.router);
    return yield* sql<FirstLoginCandidate>`SELECT v.username, v.id AS "routerId",
        b.activated_at AS "activatedAt", v.last_seen AS "lastSeen"
      FROM voucher_cache v
      JOIN voucher_baselines b ON b.router_key = v.router_key AND b.customer = v.customer
        AND b.username = v.username AND b.router_id = v.id AND b.profile = v.profile
      JOIN voucher_profiles p ON p.router_key = v.router_key AND p.name = v.profile
      WHERE v.router_key = ${key} AND v.customer = ${scope.customer}
        AND p.validity > 0 AND p.starts_at = 'logon' AND b.first_login_at IS NULL
        AND v.last_seen IS NOT NULL
        AND (b.activated_at IS NULL OR v.last_seen >= b.activated_at)
        AND (b.first_login_checked_through IS NULL OR v.last_seen > b.first_login_checked_through)
      ORDER BY b.first_login_checked_through IS NOT NULL, v.last_seen DESC
      LIMIT ${limit}`;
  }, Effect.mapError(storageError));

  const saveFirstLogin = Effect.fn("VoucherStore.saveFirstLogin")(function* (
    scope: VoucherScope,
    candidate: FirstLoginCandidate,
    firstLoginAt: string | null,
  ) {
    yield* sql`UPDATE voucher_baselines SET first_login_at = ${firstLoginAt},
      first_login_checked_through = ${candidate.lastSeen}
      WHERE router_key = ${routerKey(scope.router)} AND customer = ${scope.customer}
      AND username = ${candidate.username} AND router_id = ${candidate.routerId}`;
  }, Effect.mapError(storageError));

  const createBatch = Effect.fn("VoucherStore.createBatch")(function* (
    scope: VoucherScope,
    batch: {
      requestId: string;
      createdAt: string;
      requested: number;
      profile: string;
      comment: string;
    },
  ) {
    const rows = yield* sql<{ id: number }>`INSERT INTO voucher_batches ${sql.insert({
      router_key: routerKey(scope.router),
      customer: scope.customer,
      request_id: batch.requestId,
      created_at: batch.createdAt,
      requested: batch.requested,
      profile: batch.profile,
      comment: batch.comment,
    })} ON CONFLICT(request_id) DO UPDATE SET request_id = excluded.request_id RETURNING id`;
    return rows[0]!.id;
  }, Effect.mapError(storageError));

  const addBatchMember = Effect.fn("VoucherStore.addBatchMember")(function* (
    scope: VoucherScope,
    batchId: number,
    username: string,
    routerId: string,
  ) {
    yield* sql`INSERT OR REPLACE INTO voucher_batch_members VALUES (${batchId}, ${routerKey(scope.router)},
      ${scope.customer}, ${username}, ${routerId})`;
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
    routerNow: Effect.fn("VoucherStore.routerNow")(routerNowFor, Effect.mapError(storageError)),
    list,
    row,
    replace,
    upsert,
    remove,
    firstLoginCandidates,
    saveFirstLogin,
    createBatch,
    addBatchMember,
    operation,
    saveOperation,
    history,
  });
});
export const layer = Layer.effect(VoucherStore, make);
