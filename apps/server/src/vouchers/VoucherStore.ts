import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
  type VoucherFieldFilter,
  type VoucherFieldValue,
  type VoucherAssignments,
  type VoucherTarget,
} from "@madar/contracts";
import { routerKey } from "../routers/RouterApi.ts";
import { epochToNaive, naturalKey } from "./routerValues.ts";
import type { DatabaseContents } from "./VoucherSnapshotReader.ts";

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
/** What a refresh saw that the API counters alone cannot explain. */
export interface RefreshSignals {
  readonly newUsed: number;
  readonly profileChanged: number;
  readonly counterDropped: number;
  /** Used vouchers whose package start neither Madar nor a fresh copy explains. */
  readonly unexplained: number;
}
/** Router database copy state for one router; persisted so restarts keep the cooldown. */
export interface DatabaseState {
  readonly lastAttemptAt: string | null;
  readonly lastAutomaticAt: string | null;
  readonly lastOutcome: "accepted" | "unchanged" | "failed" | "cancelled" | null;
  readonly acceptedAt: string | null;
  readonly acceptedBusy: boolean;
  /** Size, mtime, change counter and header hash of the last exact copy; null after a busy one. */
  readonly fingerprint: string | null;
  readonly failureStage: string | null;
  readonly failureReason: string | null;
  readonly failureDetail: string | null;
  readonly failedAt: string | null;
  readonly paused: boolean;
  readonly retryAt: string | null;
  readonly hostKey: string | null;
  readonly offeredHostKey: string | null;
}
export interface CaptureRecord {
  readonly capturedAt: string | null;
  readonly busy: boolean;
  readonly checkedAt: string;
  readonly outcome: "accepted" | "unchanged" | "failed" | "cancelled";
  readonly matched: number;
  readonly skipped: number;
  readonly idConfirmed: number;
  readonly unused: number;
  /** Vouchers whose remaining value the copy changed, and those still unknown after it. */
  readonly changed: number | null;
  readonly unknown: number | null;
}
export interface PublishedCopy {
  readonly customer: string;
  readonly matched: number;
  /** Users the copy could not read or match to exactly one voucher. */
  readonly skipped: number;
  readonly unused: number;
  readonly changed: number;
  readonly unknown: number;
}
/**
 * A busy copy may read a user's lifetime counters and its package counters from commits seconds
 * apart. Within this gap they still describe one package; a larger one means usage outside it.
 */
const onlyPackageGap = (lifetime: number) => Math.max(16 * 1024 * 1024, lifetime * 0.02);
const apiIdNumber = (id: string) => {
  const match = /^\*([0-9a-f]{1,13})$/i.exec(id);
  return match ? Number.parseInt(match[1]!, 16) : null;
};
/** Snapshot rows are written in pages of this size inside the publishing transaction. */
const WRITE_BATCH = 500;
/** A macrotask turn: lets worker replies and other I/O run between pages of synchronous SQL. */
const breathe = Effect.callback<void>((resume) => {
  const handle = setImmediate(() => resume(Effect.void));
  return Effect.sync(() => clearImmediate(handle));
});
export interface FirstLoginCandidate {
  readonly username: string;
  readonly routerId: string;
  /** Router-local time; earlier sessions belong to an older profile or an older voucher. */
  readonly sessionsAfter: string;
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
  sessions_after: string | null;
  download: number;
  upload: number;
  uptime: number;
  recorded_at: string;
  first_login_at: string | null;
  first_login_checked_through: string | null;
  first_login_attempted_at: string | null;
}
type Previous = RouterColumns & { id: string };
const unused = (voucher: RouterVoucher) =>
  voucher.lastSeen === "never" &&
  voucher.download === 0 &&
  voucher.upload === 0 &&
  (voucher.uptime ?? 0) === 0;

/**
 * Lab gate: rolling a router database copy forward with the live counters assumes User Manager
 * starts a queued package only after the current one ends. Turn this off if the lab disproves
 * it; the list then shows the copy's own values with their capture time.
 */
const ROLL_FORWARD_AFTER_COPY = true;
/** A router database copy older than this no longer describes the current package. */
const COPY_FRESH_SECONDS = 86_400;

/**
 * Remaining data and validity, computed from the typed cache, the profile catalog, Madar's
 * baselines and router database copies. This is the only implementation; display, filters and
 * sorting all read it. Parameters: router key, customer, router-local "now" in epoch seconds (or
 * NULL), PC "now" in epoch seconds, then `ids` voucher ids when the rows are limited to a page.
 */
const rowsSql = (ids: number) => `
WITH base AS (SELECT ? AS router_key, ? AS customer, ? AS now, ? AS pc_now),
params AS (
  SELECT base.*,
    COALESCE((SELECT limits_synced FROM voucher_routers r WHERE r.router_key = base.router_key), 0)
      AS limits_synced,
    (SELECT synced_at FROM voucher_sync y WHERE y.router_key = base.router_key
      AND y.customer = base.customer) AS synced_at,
    c.captured_at, COALESCE(c.copied_until, c.captured_at) AS copied_until,
    COALESCE(c.busy, 0) AS captured_busy
  FROM base LEFT JOIN voucher_db_captures c ON c.router_key = base.router_key
    AND c.customer = base.customer
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
  SELECT v.*, params.now, params.pc_now, params.limits_synced, params.captured_at,
    params.copied_until, params.captured_busy,
    max(v.observed_at, COALESCE(params.synced_at, '')) AS seen_at,
    q.name IS NOT NULL AS q_known, q.validity AS q_validity, q.starts_at AS q_starts_at,
    q.price AS q_price, q.q_transfer, q.q_download, q.q_upload, q.q_uptime, q.q_unclear,
    COALESCE(q.q_transfer, 0) || ':' || COALESCE(q.q_download, 0) || ':'
      || COALESCE(q.q_upload, 0) || ':' || COALESCE(q.q_uptime, 0) AS q_signature,
    b.source AS b_source, b.activated_at AS b_activated_at, b.download AS b_download,
    b.upload AS b_upload, b.uptime AS b_uptime, b.first_login_at, b.sessions_after AS b_sessions_after,
    b.first_login_checked_through,
    s.profile AS s_profile, s.download AS s_download, s.upload AS s_upload, s.uptime AS s_uptime,
    s.life_download AS s_life_download, s.life_upload AS s_life_upload,
    s.life_uptime AS s_life_uptime, s.started_at AS s_started_at, s.ends_at AS s_ends_at,
    s.quota_signature AS s_signature,
    bt.id AS batch_id, bt.created_at AS batch_created_at, bt.requested AS batch_requested,
    bt.profile AS batch_profile, bt.comment AS batch_comment,
    (SELECT COUNT(*) FROM voucher_batch_members c WHERE c.batch_id = bt.id) AS batch_created
  FROM voucher_cache v ${ids ? "" : "NOT INDEXED"}
  JOIN params ON v.router_key = params.router_key AND v.customer = params.customer
    ${ids ? `AND v.id IN (${Array.from({ length: ids }, () => "?").join(", ")})` : ""}
  LEFT JOIN quota q ON q.name = v.profile
  LEFT JOIN voucher_baselines b ON b.router_key = v.router_key AND b.customer = v.customer
    AND b.username = v.username AND b.router_id = v.id AND b.profile = v.profile
  LEFT JOIN voucher_db_snapshots s ON s.router_key = v.router_key AND s.customer = v.customer
    AND s.api_id = v.id AND s.username = v.username
  LEFT JOIN voucher_batch_members m ON m.router_key = v.router_key AND m.customer = v.customer
    AND m.username = v.username AND m.router_id = v.id
  LEFT JOIN voucher_batches bt ON bt.id = m.batch_id
),
copied AS (
  SELECT *,
    COALESCE(s_profile = profile AND pc_now - unixepoch(captured_at) > ${COPY_FRESH_SECONDS}, 0)
      AS s_stale,
    -- The copy describes the current package: same profile, fresh, and no counter went down
    -- since it, judged only once a refresh after the whole copy has read the counters.
    COALESCE(s_profile = profile AND pc_now - unixepoch(captured_at) <= ${COPY_FRESH_SECONDS}
      AND download_used IS NOT NULL AND upload_used IS NOT NULL
      AND (seen_at <= copied_until OR (download_used >= s_life_download
        AND upload_used >= s_life_upload AND COALESCE(uptime_used, s_life_uptime) >= s_life_uptime)),
      0) AS s_ok
  FROM joined
),
rolled AS (
  SELECT *,
    COALESCE(${ROLL_FORWARD_AFTER_COPY ? 1 : 0} AND s_ok AND seen_at > copied_until
      AND s_signature = q_signature
      AND (s_ends_at IS NULL OR (now IS NOT NULL AND unixepoch(s_ends_at) > now))
      AND (q_transfer IS NULL OR s_download + s_upload + download_used - s_life_download
        + upload_used - s_life_upload < q_transfer)
      AND (q_download IS NULL OR s_download + download_used - s_life_download < q_download)
      AND (q_upload IS NULL OR s_upload + upload_used - s_life_upload < q_upload)
      AND (q_uptime IS NULL OR s_uptime + COALESCE(uptime_used - s_life_uptime, 0) < q_uptime),
      0) AS s_live
  FROM copied
),
used AS (
  SELECT *,
    -- Madar's own start of this package (its activation, seen unused, or a copy that showed it is
    -- the only one) counts the live counters exactly and outranks a copy's own numbers.
    COALESCE(b_source IN ('activation', 'new', 'only-package'), 0) AS b_exact,
    s_ok AND COALESCE(b_source NOT IN ('activation', 'new', 'only-package'), 1) AS use_copy,
    -- A busy copy's user row and counters may come from commits seconds apart. Growth stays
    -- non-negative (s_ok) and the rolled value stays under every limit (s_live).
    CASE WHEN s_ok THEN s_download
      + CASE WHEN s_live THEN download_used - s_life_download ELSE 0 END END AS p_download,
    CASE WHEN s_ok THEN s_upload
      + CASE WHEN s_live THEN upload_used - s_life_upload ELSE 0 END END AS p_upload,
    CASE WHEN s_ok THEN s_uptime
      + CASE WHEN s_live THEN COALESCE(uptime_used - s_life_uptime, 0) ELSE 0 END END AS p_uptime
  FROM rolled
),
spent AS (
  SELECT *,
    CASE WHEN use_copy THEN p_download + p_upload
      ELSE max(0, (download_used + upload_used) - (b_download + b_upload)) END AS u_transfer,
    CASE WHEN use_copy THEN p_download ELSE max(0, download_used - b_download) END AS u_download,
    CASE WHEN use_copy THEN p_upload ELSE max(0, upload_used - b_upload) END AS u_upload,
    CASE WHEN use_copy THEN p_uptime ELSE max(0, uptime_used - b_uptime) END AS u_uptime
  FROM used
),
measured AS (
  SELECT *,
    q_transfer IS NOT NULL OR q_download IS NOT NULL OR q_upload IS NOT NULL
      OR q_uptime IS NOT NULL AS has_quota,
    max(0, q_transfer - u_transfer) AS left_transfer,
    max(0, q_download - u_download) AS left_download,
    max(0, q_upload - u_upload) AS left_upload,
    max(0, q_uptime - u_uptime) AS left_uptime,
    CASE WHEN q_validity > 0 THEN
      CASE WHEN use_copy THEN s_started_at
        ELSE CASE q_starts_at WHEN 'now' THEN b_activated_at WHEN 'logon' THEN first_login_at END
      END
    END AS valid_from,
    CASE WHEN use_copy THEN COALESCE(q_validity > 0 AND s_started_at IS NULL
        AND s_download + s_upload = 0
        AND download_used + upload_used <= s_life_download + s_life_upload, 0)
      ELSE COALESCE(q_validity > 0 AND q_starts_at = 'logon' AND first_login_at IS NULL AND (
        last_seen_never = 1 OR last_seen < COALESCE(b_activated_at, b_sessions_after)
      ), 0) END AS not_started
  FROM spent
),
reasoned AS (
  SELECT *,
    CASE
      WHEN profile = '' THEN ''
      WHEN NOT q_known OR NOT limits_synced THEN 'catalog'
      WHEN q_unclear OR q_validity IS NULL
        OR (q_validity > 0 AND q_starts_at NOT IN ('now', 'logon')) THEN 'limits'
      WHEN NOT has_quota AND q_validity = 0 THEN ''
      WHEN b_source IS NULL AND NOT use_copy THEN CASE WHEN s_stale THEN 'stale' ELSE 'baseline' END
      WHEN has_quota AND (download_used IS NULL OR upload_used IS NULL
        OR (q_uptime IS NOT NULL AND uptime_used IS NULL)) THEN 'counters'
      WHEN NOT use_copy AND q_validity > 0 AND q_starts_at = 'now' AND b_activated_at IS NULL
        THEN 'activation'
      WHEN q_validity > 0 AND valid_from IS NULL AND NOT not_started THEN 'first-login'
      WHEN q_validity > 0 AND valid_from IS NOT NULL AND now IS NULL THEN 'clock'
      ELSE '' END AS rem_reason,
    NULLIF(min(
      COALESCE(left_transfer * 1.0 / q_transfer, 9), COALESCE(left_download * 1.0 / q_download, 9),
      COALESCE(left_upload * 1.0 / q_upload, 9), COALESCE(left_uptime * 1.0 / q_uptime, 9)
    ), 9) AS data_ratio,
    CASE WHEN valid_from IS NOT NULL THEN
      COALESCE(CASE WHEN use_copy THEN s_ends_at END,
        datetime(unixepoch(valid_from) + q_validity, 'unixepoch'))
    END AS valid_until,
    CASE WHEN use_copy THEN CASE WHEN s_live THEN 'router-database-live' ELSE 'router-database' END
      ELSE COALESCE(b_source, '') END AS rem_basis,
    CASE WHEN b_exact THEN u_transfer WHEN s_ok THEN p_download + p_upload END AS pkg_used,
    CASE WHEN b_exact THEN u_download WHEN s_ok THEN p_download END AS pkg_download,
    CASE WHEN b_exact THEN u_upload WHEN s_ok THEN p_upload END AS pkg_upload,
    CASE WHEN b_exact THEN u_uptime WHEN s_ok THEN p_uptime END AS pkg_uptime,
    CASE WHEN b_exact THEN CASE q_starts_at WHEN 'now' THEN b_activated_at ELSE first_login_at END
      WHEN s_ok THEN s_started_at END AS pkg_start,
    CASE WHEN NOT b_exact AND s_ok THEN 1 ELSE 0 END AS pkg_copied
  FROM measured
),
timed AS (
  SELECT *,
    CASE WHEN valid_until IS NOT NULL THEN max(0, unixepoch(valid_until) - now) END AS time_left
  FROM reasoned
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
      ELSE 'uptime' END AS rem_kind,
    CASE WHEN pkg_copied THEN s_ends_at ELSE valid_until END AS pkg_end,
    CASE WHEN use_copy OR (s_stale AND b_source IS NULL) THEN captured_at END AS rem_captured,
    CASE WHEN use_copy OR (s_stale AND b_source IS NULL) THEN captured_busy ELSE 0 END
      AS rem_captured_busy
  FROM timed
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
  // Data quotas first, then plans limited only by time; unlimited plans have no quota.
  quota:
    "COALESCE(q_transfer, q_download, q_upload, 1000000000000000000 + COALESCE(q_uptime, NULLIF(q_validity, 0)))",
  sharedUsers: "CASE WHEN shared_users_unlimited THEN 9e18 ELSE shared_users END",
  macLock: "NULLIF(lower(caller_id), '')",
  macBind: "caller_id_bind",
  ipAddress: "NULLIF(ip_address, '')",
  ipv6Dns: "NULLIF(ipv6_dns, '')",
  ipv6Prefix: "NULLIF(ipv6_prefix, '')",
  wireless: "NULLIF(lower(wireless_enc_algo), '')",
  flags: "NULLIF(active * 2 + incomplete, 0)",
  activeFlag: "active",
  incompleteFlag: "incomplete",
  firstName: "NULLIF(lower(first_name), '')",
  lastName: "NULLIF(lower(last_name), '')",
  phone: "NULLIF(phone, '')",
  email: "NULLIF(lower(email), '')",
  location: "NULLIF(lower(location), '')",
  firstSeen: "first_seen_at",
  changed: "changed_at",
  firstLogin: "first_login_at",
  batch: "batch_created_at",
  packageUsage: "pkg_used",
  packageStart: "pkg_start",
  packageEnd: "pkg_end",
  custom: "username_key",
};

/** One local field's value for the voucher in scope `v0`; the field id is the first parameter. */
const fieldValueOf = `voucher_field_values fv WHERE fv.field_id = ? AND fv.router_key = v0.router_key
  AND fv.customer = v0.customer AND fv.username = v0.username AND fv.router_id = v0.id`;
const fieldSortKey = `(SELECT COALESCE(lower(fv.text_value), fv.number_value, fv.date_value, fv.bool_value,
  (SELECT c.position FROM voucher_field_choices c WHERE c.id = fv.choice_id)) FROM ${fieldValueOf})`;
type SqlValue = string | number | null;

function fieldFilter(filter: VoucherFieldFilter): { sql: string; params: SqlValue[] } {
  const exists = (condition: string, params: SqlValue[]) => ({
    sql: `EXISTS (SELECT 1 FROM ${fieldValueOf} ${condition})`,
    params: [filter.fieldId, ...params],
  });
  switch (filter.op) {
    case "empty":
      return { sql: `NOT EXISTS (SELECT 1 FROM ${fieldValueOf})`, params: [filter.fieldId] };
    case "filled":
      return exists("", []);
    case "contains":
      return exists("AND instr(lower(fv.text_value), lower(?)) > 0", [filter.text]);
    case "range":
      return exists(
        "AND fv.number_value >= COALESCE(?, fv.number_value) AND fv.number_value <= COALESCE(?, fv.number_value)",
        [filter.min, filter.max],
      );
    case "dates":
      return exists(
        "AND fv.date_value >= COALESCE(?, fv.date_value) AND fv.date_value <= COALESCE(?, fv.date_value)",
        [filter.from, filter.to],
      );
    case "flag":
      return exists("AND fv.bool_value = ?", [Number(filter.value)]);
    case "choice":
      return exists("AND fv.choice_id = ?", [filter.choiceId]);
  }
}

/**
 * Empty, never and unknown values are NULL and stay last in both directions. The voucher row is
 * `v0`; a local field's id is bound as a parameter, never written into the SQL.
 */
export function orderBy(sort: VoucherQuery["sort"]): { sql: string; params: SqlValue[] } {
  const direction = sort.direction === "desc" ? "DESC" : "ASC";
  const fieldId = sort.field === "custom" ? sort.fieldId : undefined;
  if (sort.field === "username" || (sort.field === "custom" && fieldId === undefined))
    return { sql: `username_key ${direction}, id ${direction}`, params: [] };
  const expression = fieldId === undefined ? sortKeys[sort.field] : fieldSortKey;
  return {
    sql: `(${expression}) IS NULL, ${expression} ${direction}, username_key, id`,
    params: fieldId === undefined ? [] : [fieldId, fieldId],
  };
}
const joinedSorts = new Set<VoucherSortField>([
  "remaining",
  "price",
  "quota",
  "firstLogin",
  "batch",
  "packageUsage",
  "packageStart",
  "packageEnd",
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
const toRow = (
  row: ListRow,
  syncedAt: string | undefined,
  fields: VoucherRow["fields"],
): VoucherRow => {
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
  const validity = num(row.q_validity);
  const endsAt = known ? str(row.valid_until) || null : null;
  const basis = str(row.rem_basis) as VoucherRow["remaining"]["basis"];
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
      basis: known || state === "unknown" ? basis : "",
      capturedAt: str(row.rem_captured) || null,
      capturedBusy: bool(row.rem_captured_busy),
    },
    package:
      row.pkg_used === null
        ? null
        : {
            download: num(row.pkg_download) ?? 0,
            upload: num(row.pkg_upload) ?? 0,
            uptime: num(row.pkg_uptime) ?? 0,
            startedAt: str(row.pkg_start) || null,
            endsAt: str(row.pkg_end) || null,
            estimated: bool(row.pkg_copied) && bool(row.s_live),
            capturedAt: bool(row.pkg_copied) ? str(row.captured_at) : null,
            capturedBusy: bool(row.pkg_copied) && bool(row.captured_busy),
          },
    fields,
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
    ) => Effect.Effect<RefreshSignals, VoucherFailure>;
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
      outcome?: "read" | "failed",
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
    /** Forgets router database copies of these vouchers before Madar changes their package. */
    readonly invalidateSnapshots: (
      scope: VoucherScope,
      ids: readonly string[],
    ) => Effect.Effect<void, VoucherFailure>;
    readonly databaseState: (key: string) => Effect.Effect<DatabaseState | null, VoucherFailure>;
    readonly saveDatabaseState: (
      key: string,
      state: DatabaseState,
    ) => Effect.Effect<void, VoucherFailure>;
    readonly capture: (scope: VoucherScope) => Effect.Effect<CaptureRecord | null, VoucherFailure>;
    readonly recordAttempt: (
      key: string,
      attempt: {
        outcome: "unchanged" | "failed" | "cancelled";
        checkedAt: string;
        /** For an unchanged file: confirms copies with this fingerprint as of `checkedAt`. */
        fingerprint?: string;
      },
    ) => Effect.Effect<void, VoucherFailure>;
    readonly publishSnapshot: (
      key: string,
      copy: { capturedAt: string; copiedUntil: string; busy: boolean; fingerprint: string | null },
      contents: DatabaseContents,
    ) => Effect.Effect<readonly PublishedCopy[], VoucherFailure>;
    readonly assignments: (
      target: VoucherTarget,
    ) => Effect.Effect<VoucherAssignments, VoucherFailure>;
  }
>()("madar/vouchers/VoucherStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const nowSeconds = Clock.currentTimeMillis.pipe(Effect.map((ms) => Math.floor(ms / 1000)));
  const clockOffsetFor = Effect.fnUntraced(function* (key: string) {
    const rows = yield* sql<{
      clock_offset: number | null;
    }>`SELECT clock_offset FROM voucher_routers WHERE router_key = ${key}`;
    return rows[0]?.clock_offset ?? null;
  });
  const routerNowFor = Effect.fnUntraced(function* (key: string) {
    const offset = yield* clockOffsetFor(key);
    return offset === null ? null : (yield* nowSeconds) + offset;
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

  const dropSnapshots = Effect.fnUntraced(function* (scope: VoucherScope, ids: readonly string[]) {
    for (let start = 0; start < ids.length; start += 100)
      yield* sql`DELETE FROM voucher_db_snapshots WHERE router_key = ${routerKey(scope.router)}
        AND customer = ${scope.customer} AND ${sql.in("api_id", ids.slice(start, start + 100))}`;
  });

  /** Writes router columns for changed rows and keeps baselines consistent with the new values. */
  const write = Effect.fnUntraced(function* (
    scope: VoucherScope,
    vouchers: readonly RouterVoucher[],
    previous: ReadonlyMap<string, Previous>,
    time: string,
    activations: ReadonlyMap<string, string | null>,
  ) {
    const key = routerKey(scope.router);
    const offset = yield* clockOffsetFor(key);
    const observed = DateTime.make(time);
    const routerNow = yield* routerNowFor(key);
    // Router-local time of the observation; refreshes pass the time taken before the router read.
    const estimatedAt =
      offset !== null && Option.isSome(observed)
        ? epochToNaive(DateTime.toEpochMillis(observed.value) + offset * 1000)
        : routerNow === null
          ? null
          : epochToNaive(routerNow * 1000);
    const changed = vouchers.filter((voucher) => {
      const old = previous.get(voucher.id);
      return !old || signature(old) !== signature(toColumns(voucher));
    });
    // An activation that left router columns unchanged still records its baseline.
    const changedSet = new Set(changed);
    const touched = vouchers.filter(
      (voucher) => activations.has(voucher.id) || changedSet.has(voucher),
    );
    const signals = { newUsed: 0, profileChanged: 0, counterDropped: 0 };
    if (touched.length === 0) return signals;
    // A rename keeps the voucher's Madar data. Every renamed voucher first moves to a name made
    // from its router id, so a chain (A→B, B→C) or a swap never deletes data that is still in use.
    const renamed = changed.flatMap((voucher) => {
      const old = previous.get(voucher.id);
      return old && old.username !== voucher.username ? [{ voucher, from: old.username }] : [];
    });
    const madarTables = ["voucher_baselines", "voucher_batch_members", "voucher_field_values"];
    for (const { voucher, from } of renamed)
      for (const table of madarTables)
        yield* sql`UPDATE ${sql(table)} SET username = ${`\u0000${voucher.id}`} WHERE router_key = ${key}
          AND customer = ${scope.customer} AND username = ${from} AND router_id = ${voucher.id}`;
    for (const { voucher } of renamed)
      for (const table of madarTables) {
        // Rows left under the new name belong to a voucher that no longer exists.
        yield* sql`DELETE FROM ${sql(table)} WHERE router_key = ${key} AND customer = ${scope.customer}
          AND username = ${voucher.username} AND router_id != ${voucher.id}`;
        yield* sql`UPDATE ${sql(table)} SET username = ${voucher.username} WHERE router_key = ${key}
          AND customer = ${scope.customer} AND username = ${`\u0000${voucher.id}`} AND router_id = ${voucher.id}`;
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
          sessions_after, download, upload, uptime, recorded_at, first_login_at,
          first_login_checked_through, first_login_attempted_at
          FROM voucher_baselines WHERE router_key = ${key}
          AND customer = ${scope.customer} AND ${sql.in("username", names)}`)
        baselines.set(row.username, row);
    }
    const recorded: Record<string, string | number | null>[] = [];
    const invalidated: string[] = [];
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
      const sample = { download: voucher.download, upload: voucher.upload, uptime: voucher.uptime };
      const seen = old
        ? {
            download: old.download_used as number | null,
            upload: old.upload_used as number | null,
            uptime: old.uptime_used as number | null,
          }
        : null;
      // An unreadable counter is not a drop; only readable values on both sides are compared.
      const dropped = (from: { [K in keyof typeof sample]: number | null } | null) =>
        from !== null &&
        (["download", "upload", "uptime"] as const).some(
          (key) => sample[key] !== null && from[key] !== null && sample[key]! < from[key]!,
        );
      const fresh = !baseline || baseline.profile !== voucher.profile;
      if (!old && !unused(voucher)) signals.newUsed++;
      // A new package or a counter reset ends the package a router database copy described.
      const profileChanged = old !== undefined && old.profile !== voucher.profile;
      const counterDropped = dropped(seen);
      if (profileChanged) signals.profileChanged++;
      if (counterDropped) signals.counterDropped++;
      if (profileChanged || counterDropped) invalidated.push(voucher.id);
      let next: {
        source: string;
        activatedAt: string | null;
        sessionsAfter: string | null;
        counters: typeof counters;
        /** A reset keeps the first-login state and the time the baseline was first recorded. */
        kept?: Pick<
          Baseline,
          | "recorded_at"
          | "first_login_at"
          | "first_login_checked_through"
          | "first_login_attempted_at"
        >;
      } | null = null;
      if (activations.has(voucher.id)) {
        const activatedAt = activations.get(voucher.id) ?? null;
        if (parsed)
          next = { source: "activation", activatedAt, sessionsAfter: activatedAt, counters };
      } else if (fresh && unused(voucher)) {
        next = { source: "new", activatedAt: null, sessionsAfter: estimatedAt, counters };
      } else if (baseline && baseline.profile !== voucher.profile) {
        if (parsed)
          next = {
            source: "profile-change",
            activatedAt: estimatedAt,
            sessionsAfter: estimatedAt,
            counters,
          };
      } else if (!baseline && old && old.profile !== voucher.profile) {
        if (parsed)
          next = {
            source: "profile-change",
            activatedAt: estimatedAt,
            sessionsAfter: estimatedAt,
            counters,
          };
      } else if (baseline && (dropped(baseline) || dropped(seen))) {
        // Counters went down since the baseline or the last refresh: another tool reset them.
        next = {
          source: "counter-reset",
          activatedAt: baseline.activated_at,
          sessionsAfter: baseline.sessions_after,
          counters: { download: 0, upload: 0, uptime: 0 },
          kept: baseline,
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
          sessions_after: next.sessionsAfter,
          download: next.counters.download,
          upload: next.counters.upload,
          uptime: next.counters.uptime,
          recorded_at: next.kept?.recorded_at ?? time,
          first_login_at: next.kept?.first_login_at ?? null,
          first_login_checked_through: next.kept?.first_login_checked_through ?? null,
          first_login_attempted_at: next.kept?.first_login_attempted_at ?? null,
        });
    }
    for (let start = 0; start < recorded.length; start += 100)
      yield* sql`INSERT OR REPLACE INTO voucher_baselines ${sql.insert(recorded.slice(start, start + 100))}`;
    yield* dropSnapshots(scope, invalidated);
    return signals;
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
        for (const table of ["voucher_baselines", "voucher_field_values"])
          yield* sql`DELETE FROM ${sql(table)} WHERE router_key = ${key} AND customer = ${scope.customer}
            AND username = ${row.username} AND router_id = ${row.id}`;
      const ids = slice.map((row) => row.id);
      yield* dropSnapshots(scope, ids);
      yield* sql`DELETE FROM voucher_db_assignments WHERE router_key = ${key}
        AND customer = ${scope.customer} AND ${sql.in("api_id", ids)}`;
    }
  });

  const replace = Effect.fn("VoucherStore.replace")(function* (
    scope: VoucherScope,
    vouchers: readonly RouterVoucher[],
    time: string,
  ) {
    const key = routerKey(scope.router);
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const previous = yield* readPrevious(scope);
        const incoming = new Set(vouchers.map((voucher) => voucher.id));
        yield* deleteVouchers(
          scope,
          [...previous.values()].filter((row) => !incoming.has(row.id)),
        );
        const signals = yield* write(scope, vouchers, previous, time, new Map());
        yield* sql`INSERT OR REPLACE INTO voucher_sync VALUES (${key}, ${scope.customer}, ${time})`;
        // A copy only matched the vouchers cached then; new used ones need a full copy, even of
        // an unchanged file.
        if (signals.newUsed > 0)
          yield* sql`UPDATE voucher_db_routers SET fingerprint = NULL WHERE router_key = ${key}`;
        const stale = DateTime.formatIso(
          DateTime.makeUnsafe(((yield* nowSeconds) - COPY_FRESH_SECONDS) * 1000),
        );
        // Used vouchers whose package start neither Madar nor a fresh copy explains.
        const unexplained = yield* sql<{ count: number }>`SELECT COUNT(*) AS count
          FROM voucher_cache v
          LEFT JOIN voucher_baselines b ON b.router_key = v.router_key AND b.customer = v.customer
            AND b.username = v.username AND b.router_id = v.id AND b.profile = v.profile
          LEFT JOIN voucher_db_snapshots s ON s.router_key = v.router_key
            AND s.customer = v.customer AND s.api_id = v.id AND s.username = v.username
            AND s.profile = v.profile
          LEFT JOIN voucher_db_captures c ON c.router_key = v.router_key AND c.customer = v.customer
          WHERE v.router_key = ${key} AND v.customer = ${scope.customer} AND v.profile != ''
            AND v.download_used + v.upload_used > 0 AND b.username IS NULL
            AND (s.api_id IS NULL OR c.captured_at IS NULL OR c.captured_at < ${stale})`;
        return { ...signals, unexplained: unexplained[0]?.count ?? 0 };
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
      yield* nowSeconds,
      ...ids,
    ]);
    const values = yield* sql<{
      field_id: number;
      username: string;
      router_id: string;
      text_value: string | null;
      number_value: number | null;
      date_value: string | null;
      bool_value: number | null;
      choice_id: number | null;
    }>`SELECT field_id, username, router_id, text_value, number_value, date_value, bool_value,
        choice_id FROM voucher_field_values WHERE router_key = ${key} AND customer = ${scope.customer}
        AND ${sql.in(
          "username",
          rows.map((row) => str(row.username)),
        )}`;
    const fields = new Map<string, Record<string, VoucherFieldValue>>();
    for (const value of values) {
      const typed =
        value.text_value ??
        value.number_value ??
        value.date_value ??
        (value.bool_value === null ? value.choice_id : value.bool_value === 1);
      if (typed === null) continue;
      const record = fields.get(value.router_id) ?? {};
      record[String(value.field_id)] = typed;
      fields.set(value.router_id, record);
    }
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [{ row, fields: fields.get(id) ?? {} }] : [];
    });
  });

  const list = Effect.fn("VoucherStore.list")(
    function* (query: VoucherQuery) {
      const key = routerKey(query.router);
      const where: string[] = [];
      const values: SqlValue[] = [];
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
      if (query.fieldFilter) {
        const filter = fieldFilter(query.fieldFilter);
        where.push(filter.sql);
        values.push(...filter.params);
      }
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
              `SELECT COUNT(*) AS total FROM voucher_cache AS v0 ${query.profile ? "" : "NOT INDEXED"} WHERE ${scoped}`,
              [key, query.customer, ...values],
            );
            const rows = yield* sql.unsafe<{ id: string }>(
              `SELECT id FROM voucher_cache AS v0 WHERE ${scoped} ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
              [key, query.customer, ...values, ...order.params, ...page],
            );
            total = count[0]?.total ?? 0;
            ids = rows.map((row) => row.id);
          } else {
            const now = yield* routerNowFor(key);
            const params = [key, query.customer, now, yield* nowSeconds, ...values];
            // One pass: the window count avoids computing remaining twice over every row.
            const rows = yield* sql.unsafe<{ id: string; total: number }>(
              `${rowsSql(0)} SELECT id, COUNT(*) OVER () AS total FROM ranked AS v0 WHERE ${condition}
                ORDER BY ${order.sql} LIMIT ? OFFSET ?`,
              [...params, ...order.params, ...page],
            );
            total =
              rows[0]?.total ??
              (yield* sql.unsafe<{ total: number }>(
                `${rowsSql(0)} SELECT COUNT(*) AS total FROM ranked AS v0 WHERE ${condition}`,
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
            items: rows.map((item) => toRow(item.row, sync[0]?.synced_at, item.fields)),
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
    return found ? toRow(found.row, undefined, found.fields) : null;
  }, Effect.mapError(storageError));

  const firstLoginCandidates = Effect.fn("VoucherStore.firstLoginCandidates")(function* (
    scope: VoucherScope,
    limit: number,
  ) {
    const key = routerKey(scope.router);
    // A cutoff missed while the clock was unreadable is rebuilt from the Madar time it was recorded.
    const shift = `${(yield* clockOffsetFor(key)) ?? ""} seconds`;
    return yield* sql<FirstLoginCandidate>`SELECT v.username, v.id AS "routerId",
        COALESCE(b.activated_at, b.sessions_after, datetime(b.recorded_at, ${shift})) AS "sessionsAfter",
        v.last_seen AS "lastSeen"
      FROM voucher_cache v
      JOIN voucher_baselines b ON b.router_key = v.router_key AND b.customer = v.customer
        AND b.username = v.username AND b.router_id = v.id AND b.profile = v.profile
      JOIN voucher_profiles p ON p.router_key = v.router_key AND p.name = v.profile
      WHERE v.router_key = ${key} AND v.customer = ${scope.customer}
        AND p.validity > 0 AND p.starts_at = 'logon' AND b.first_login_at IS NULL
        AND v.last_seen IS NOT NULL
        AND v.last_seen >= COALESCE(b.activated_at, b.sessions_after, datetime(b.recorded_at, ${shift}))
        AND (b.first_login_checked_through IS NULL OR v.last_seen > b.first_login_checked_through)
      ORDER BY b.first_login_attempted_at IS NOT NULL, b.first_login_attempted_at, v.last_seen DESC
      LIMIT ${limit}`;
  }, Effect.mapError(storageError));

  const saveFirstLogin = Effect.fn("VoucherStore.saveFirstLogin")(function* (
    scope: VoucherScope,
    candidate: FirstLoginCandidate,
    firstLoginAt: string | null,
    outcome: "read" | "failed" = "read",
  ) {
    const attempted = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
    // A failed read only moves the voucher behind the others; it is retried later.
    yield* outcome === "failed"
      ? sql`UPDATE voucher_baselines SET first_login_attempted_at = ${attempted}
          WHERE router_key = ${routerKey(scope.router)} AND customer = ${scope.customer}
          AND username = ${candidate.username} AND router_id = ${candidate.routerId}`
      : sql`UPDATE voucher_baselines SET first_login_at = ${firstLoginAt},
      first_login_checked_through = ${candidate.lastSeen}, first_login_attempted_at = ${attempted}
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
  const invalidateSnapshots = Effect.fn("VoucherStore.invalidateSnapshots")(function* (
    scope: VoucherScope,
    ids: readonly string[],
  ) {
    yield* dropSnapshots(scope, ids);
  }, Effect.mapError(storageError));

  const databaseState = Effect.fn("VoucherStore.databaseState")(function* (key: string) {
    const rows = yield* sql<DatabaseState>`SELECT last_attempt_at AS "lastAttemptAt",
        last_automatic_at AS "lastAutomaticAt", last_outcome AS "lastOutcome",
        accepted_at AS "acceptedAt", accepted_busy AS "acceptedBusy", fingerprint,
        failure_stage AS "failureStage", failure_reason AS "failureReason",
        failure_detail AS "failureDetail", failed_at AS "failedAt",
        paused, retry_at AS "retryAt", host_key AS "hostKey", offered_host_key AS "offeredHostKey"
      FROM voucher_db_routers WHERE router_key = ${key}`;
    const row = rows[0];
    return row
      ? { ...row, paused: Boolean(row.paused), acceptedBusy: Boolean(row.acceptedBusy) }
      : null;
  }, Effect.mapError(storageError));

  const saveDatabaseState = Effect.fn("VoucherStore.saveDatabaseState")(function* (
    key: string,
    state: DatabaseState,
  ) {
    yield* sql`INSERT OR REPLACE INTO voucher_db_routers ${sql.insert({
      router_key: key,
      last_attempt_at: state.lastAttemptAt,
      last_automatic_at: state.lastAutomaticAt,
      last_outcome: state.lastOutcome,
      accepted_at: state.acceptedAt,
      accepted_busy: Number(state.acceptedBusy),
      fingerprint: state.fingerprint,
      failure_stage: state.failureStage,
      failure_reason: state.failureReason,
      failure_detail: state.failureDetail,
      failed_at: state.failedAt,
      paused: Number(state.paused),
      retry_at: state.retryAt,
      host_key: state.hostKey,
      offered_host_key: state.offeredHostKey,
    })}`;
  }, Effect.mapError(storageError));

  const capture = Effect.fn("VoucherStore.capture")(function* (scope: VoucherScope) {
    const rows =
      yield* sql<CaptureRecord>`SELECT captured_at AS "capturedAt", busy, checked_at AS "checkedAt",
        outcome, matched, skipped,
        id_confirmed AS "idConfirmed", unused, changed, unknown
      FROM voucher_db_captures WHERE router_key = ${routerKey(scope.router)}
      AND customer = ${scope.customer}`;
    const row = rows[0];
    return row ? { ...row, busy: Boolean(row.busy) } : null;
  }, Effect.mapError(storageError));

  /** Records an attempt that did not publish a copy; the last accepted copy stays in use. */
  const recordAttempt = Effect.fn("VoucherStore.recordAttempt")(function* (
    key: string,
    attempt: {
      outcome: "unchanged" | "failed" | "cancelled";
      checkedAt: string;
      fingerprint?: string;
    },
  ) {
    if (attempt.fingerprint !== undefined)
      yield* sql`UPDATE voucher_db_captures SET captured_at = ${attempt.checkedAt},
          copied_until = ${attempt.checkedAt}
        WHERE router_key = ${key} AND fingerprint = ${attempt.fingerprint}`;
    yield* sql`INSERT INTO voucher_db_captures (router_key, customer, outcome, checked_at)
      SELECT router_key, login, ${attempt.outcome}, ${attempt.checkedAt}
        FROM voucher_customers WHERE router_key = ${key}
      ON CONFLICT(router_key, customer) DO UPDATE SET outcome = excluded.outcome,
        checked_at = excluded.checked_at`;
  }, Effect.mapError(storageError));

  /**
   * What each voucher's remaining shows, to count what a copy changed. Time left is left out: it
   * moves with the clock, while the end it counts down to does not.
   */
  const remainingShown = Effect.fnUntraced(function* (key: string, customer: string) {
    const rows = yield* sql.unsafe<{ id: string; shown: string; unknown: number }>(
      `${rowsSql(0)} SELECT id, json_array(rem_reason, rem_basis, valid_until, not_started,
        left_transfer, left_download, left_upload, left_uptime) AS shown,
        rem_reason != '' AS unknown FROM ranked`,
      [key, customer, yield* routerNowFor(key), yield* nowSeconds],
    );
    return new Map(rows.map((row) => [row.id, row]));
  });

  /**
   * Publishes one copy for every customer in one transaction. Users match vouchers by customer and
   * exact username; ambiguous names match nothing. A voucher whose current package is its only one
   * gets an "only-package" baseline at zero, so its live counters are that package's usage.
   */
  const publishSnapshot = Effect.fn("VoucherStore.publishSnapshot")(function* (
    key: string,
    copy: { capturedAt: string; copiedUntil: string; busy: boolean; fingerprint: string | null },
    contents: DatabaseContents,
  ) {
    const byCustomer = new Map<string, DatabaseContents["users"][number][]>();
    for (const user of contents.users) {
      const list = byCustomer.get(user.customer) ?? [];
      list.push(user);
      byCustomer.set(user.customer, list);
    }
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const customers = yield* sql<{
          login: string;
        }>`SELECT login FROM voucher_customers WHERE router_key = ${key}`;
        const published: PublishedCopy[] = [];
        for (const { login: customer } of customers) {
          const before = yield* remainingShown(key, customer);
          yield* breathe;
          const cached = yield* sql<{
            id: string;
            username: string;
            profile: string;
            last_seen_never: number;
          }>`SELECT id, username, profile, last_seen_never
            FROM voucher_cache WHERE router_key = ${key} AND customer = ${customer}`;
          const ids = new Map<string, (typeof cached)[number][]>();
          for (const row of cached) ids.set(row.username, [...(ids.get(row.username) ?? []), row]);
          const baselines = new Map(
            (yield* sql<Baseline>`SELECT * FROM voucher_baselines
              WHERE router_key = ${key} AND customer = ${customer}`).map((row) => [
              row.username,
              row,
            ]),
          );
          const names = new Map<string, number>();
          const users = byCustomer.get(customer) ?? [];
          for (const user of users) names.set(user.username, (names.get(user.username) ?? 0) + 1);
          const snapshots = new Map<string, Record<string, string | number | null>>();
          const history = new Map<string, Record<string, string | number | null>>();
          const onlyPackages: Record<string, string | number | null>[] = [];
          const notOnly: string[] = [];
          // The reader cannot tell whose unreadable rows it left out; they count for every customer.
          let skipped = contents.skipped;
          let confirmed = 0;
          let unused = 0;
          for (const user of users) {
            const matches = ids.get(user.username) ?? [];
            if (names.get(user.username) !== 1 || matches.length !== 1) {
              if (matches.length > 0) skipped++;
              continue;
            }
            const match = matches[0]!;
            const apiId = match.id;
            // Lab: API `.id` ("*1A3") may equal the database user id. Until confirmed, names decide.
            if (apiIdNumber(apiId) === user.id) confirmed++;
            for (const item of user.assignments)
              history.set(`${apiId}\u0000${item.id}`, {
                router_key: key,
                customer,
                api_id: apiId,
                db_assignment_id: item.id,
                profile: item.profile,
                assigned_at: item.assignedAt,
                started_at: item.startedAt,
                ends_at: item.endsAt,
                state: item.state,
                price: item.price,
                download: item.usage.download,
                upload: item.usage.upload,
                uptime: item.usage.uptime,
                current: Number(item.id === user.current?.id),
              });
            if (!user.current) continue;
            if (match.last_seen_never) unused++;
            snapshots.set(apiId, {
              router_key: key,
              customer,
              api_id: apiId,
              username: user.username,
              db_user_id: user.id,
              db_assignment_id: user.current.id,
              profile: user.profile,
              download: user.current.usage.download,
              upload: user.current.usage.upload,
              uptime: user.current.usage.uptime,
              life_download: user.lifetime.download,
              life_upload: user.lifetime.upload,
              life_uptime: user.lifetime.uptime,
              started_at: user.current.startedAt,
              ends_at: user.current.endsAt,
              state: user.current.state,
              quota_signature: user.quotaSignature,
              capture_ref: copy.capturedAt,
            });
            const stored = baselines.get(user.username);
            const own =
              stored?.router_id === apiId && stored.profile === match.profile ? stored : undefined;
            const lifetime = user.lifetime.download + user.lifetime.upload;
            const only =
              user.profile === match.profile &&
              user.assignments.length === 1 &&
              user.assignments[0]!.id === user.current.id &&
              lifetime - (user.current.usage.download + user.current.usage.upload) <=
                onlyPackageGap(lifetime);
            if (only && (!own || own.source === "only-package"))
              onlyPackages.push({
                router_key: key,
                customer,
                username: user.username,
                router_id: apiId,
                profile: match.profile,
                source: "only-package",
                // A login after a copy that saw the package unstarted is found in the session
                // records, as after a Madar activation.
                activated_at: user.current.startedAt ?? own?.activated_at ?? null,
                sessions_after: user.current.assignedAt ?? own?.sessions_after ?? null,
                download: 0,
                upload: 0,
                uptime: 0,
                recorded_at: own?.recorded_at ?? copy.capturedAt,
                first_login_at: user.current.startedAt ?? own?.first_login_at ?? null,
                first_login_checked_through: own?.first_login_checked_through ?? null,
                first_login_attempted_at: own?.first_login_attempted_at ?? null,
              });
            else if (!only && own?.source === "only-package") notOnly.push(user.username);
          }
          yield* syncRows("voucher_db_snapshots", key, customer, ["api_id"], snapshots, [
            "capture_ref",
          ]);
          yield* syncRows(
            "voucher_db_assignments",
            key,
            customer,
            ["api_id", "db_assignment_id"],
            history,
            [],
          );
          for (let start = 0; start < onlyPackages.length; start += 100) {
            yield* sql`INSERT OR REPLACE INTO voucher_baselines ${sql.insert(
              onlyPackages.slice(start, start + 100),
            )}`;
            if (start % WRITE_BATCH === 0) yield* breathe;
          }
          for (let start = 0; start < notOnly.length; start += 100)
            yield* sql`DELETE FROM voucher_baselines WHERE router_key = ${key}
              AND customer = ${customer} AND source = 'only-package'
              AND ${sql.in("username", notOnly.slice(start, start + 100))}`;
          yield* sql`INSERT OR REPLACE INTO voucher_db_captures ${sql.insert({
            router_key: key,
            customer,
            captured_at: copy.capturedAt,
            copied_until: copy.copiedUntil,
            busy: Number(copy.busy),
            fingerprint: copy.fingerprint,
            outcome: "accepted",
            checked_at: copy.copiedUntil,
            matched: snapshots.size,
            skipped,
            id_confirmed: confirmed,
            unused,
            changed: null,
            unknown: null,
          })}`;
          yield* breathe;
          const after = yield* remainingShown(key, customer);
          let changed = 0;
          let unknown = 0;
          for (const [id, row] of after) {
            if (before.get(id)?.shown !== row.shown) changed++;
            if (row.unknown) unknown++;
          }
          yield* sql`UPDATE voucher_db_captures SET changed = ${changed}, unknown = ${unknown}
            WHERE router_key = ${key} AND customer = ${customer}`;
          published.push({ customer, matched: snapshots.size, skipped, unused, changed, unknown });
        }
        return published;
      }),
    );
  }, Effect.mapError(storageError));

  /**
   * Makes one customer's rows equal `next`, writing only rows whose values changed. Large copies
   * hold tens of thousands of rows, so the work yields to the event loop between pages to keep
   * voucher pages answering while it runs.
   */
  const syncRows = Effect.fnUntraced(function* (
    table: "voucher_db_snapshots" | "voucher_db_assignments",
    key: string,
    customer: string,
    keyColumns: readonly string[],
    next: ReadonlyMap<string, Record<string, string | number | null>>,
    ignored: readonly string[],
  ) {
    const compared = Object.keys(next.values().next().value ?? {}).filter(
      (column) => !ignored.includes(column),
    );
    const rowKey = (row: Record<string, unknown>) =>
      keyColumns.map((column) => String(row[column])).join("\u0000");
    const content = (row: Record<string, unknown>) =>
      compared.map((column) => String(row[column] ?? "\u0000")).join("\u0001");
    const existing = new Map<string, string>();
    for (const row of yield* sql<Record<string, string | number | null>>`SELECT * FROM ${sql(table)}
        WHERE router_key = ${key} AND customer = ${customer}`)
      existing.set(rowKey(row), content(row));
    yield* breathe;
    const removed = [...existing.keys()].filter((id) => !next.has(id));
    for (const [index, id] of removed.entries()) {
      yield* sql.unsafe(
        `DELETE FROM ${table} WHERE router_key = ? AND customer = ? AND ${keyColumns
          .map((column) => `${column} = ?`)
          .join(" AND ")}`,
        [key, customer, ...id.split("\u0000")],
      );
      if (index % WRITE_BATCH === WRITE_BATCH - 1) yield* breathe;
    }
    const rows = [...next.entries()];
    for (let start = 0; start < rows.length; start += WRITE_BATCH) {
      const changed = rows
        .slice(start, start + WRITE_BATCH)
        .filter(([id, row]) => existing.get(id) !== content(row))
        .map(([, row]) => row);
      if (changed.length) yield* sql`INSERT OR REPLACE INTO ${sql(table)} ${sql.insert(changed)}`;
      yield* breathe;
    }
  });

  const assignments = Effect.fn("VoucherStore.assignments")(
    function* (target: VoucherTarget) {
      const key = routerKey(target.router);
      const rows = yield* sql<{
        db_assignment_id: number;
        profile: string;
        assigned_at: string | null;
        started_at: string | null;
        ends_at: string | null;
        state: number | null;
        price: number | null;
        download: number;
        upload: number;
        uptime: number;
        current: number;
      }>`SELECT db_assignment_id, profile, assigned_at, started_at, ends_at, state, price, download,
          upload, uptime, current FROM voucher_db_assignments WHERE router_key = ${key}
          AND customer = ${target.customer} AND api_id = ${target.id}
          ORDER BY current DESC, COALESCE(started_at, assigned_at) DESC, db_assignment_id DESC
          LIMIT 100`;
      const copy = yield* capture(target);
      return {
        capturedAt: copy?.capturedAt ?? null,
        capturedBusy: copy?.busy ?? false,
        items: rows.map((row) => ({
          id: row.db_assignment_id,
          profile: row.profile,
          assignedAt: row.assigned_at,
          startedAt: row.started_at,
          endsAt: row.ends_at,
          state: row.state,
          price: row.price,
          download: row.download,
          upload: row.upload,
          uptime: row.uptime,
          current: row.current === 1,
        })),
      };
    },
    NodeSqliteClient.readOnly,
    Effect.mapError(storageError),
  );
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
    invalidateSnapshots,
    databaseState,
    saveDatabaseState,
    capture,
    recordAttempt,
    publishSnapshot,
    assignments,
  });
});
export const layer = Layer.effect(VoucherStore, make);
