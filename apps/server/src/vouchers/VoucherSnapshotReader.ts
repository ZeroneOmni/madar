import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import * as NodeSqliteClient from "@madar/shared/nodeSqliteClient";
import { epochToNaive } from "./routerValues.ts";

export class VoucherSnapshotReadError extends Schema.TaggedError<VoucherSnapshotReadError>()(
  "VoucherSnapshotReadError",
  {
    reason: Schema.Literals(["corrupt", "schema", "values"]),
    /** The table whose layout or values were rejected. */
    table: Schema.optional(Schema.String),
  },
) {}

export interface Usage {
  readonly download: number;
  readonly upload: number;
  readonly uptime: number;
}
export interface DatabaseAssignment {
  readonly id: number;
  readonly profile: string;
  /** Router-local wall-clock times, "YYYY-MM-DD HH:MM:SS". */
  readonly assignedAt: string | null;
  readonly startedAt: string | null;
  readonly endsAt: string | null;
  readonly state: number | null;
  readonly price: number | null;
  readonly usage: Usage;
}
export interface DatabaseUser {
  readonly id: number;
  readonly customer: string;
  readonly username: string;
  readonly lifetime: Usage;
  /** The user's current profile name; empty when none is assigned. */
  readonly profile: string;
  /** Limits User Manager applies now: "transfer:download:upload:uptime", 0 for none. */
  readonly quotaSignature: string;
  readonly current: DatabaseAssignment | null;
  /** Newest first. */
  readonly assignments: readonly DatabaseAssignment[];
}
export interface DatabaseContents {
  readonly users: readonly DatabaseUser[];
  /** Users left out because their records disagree or could not be decoded. */
  readonly skipped: number;
}

/** Table rows cross from the worker in pages of this size. */
const READ_BATCH = 500;

type Kind = "integer" | "number" | "text";
/**
 * The only columns Madar reads. Passwords, registration keys and wireless keys stay out of
 * every query; the layout check fails closed when a listed column is missing or mistyped.
 */
const layout: Record<string, Record<string, Kind>> = {
  customer: { id: "integer", login: "text" },
  profile: { id: "integer", custId: "integer", name: "text" },
  user: {
    id: "integer",
    custId: "integer",
    userName: "text",
    downloadUsed: "integer",
    uploadUsed: "integer",
    uptimeUsed: "integer",
    actualProfileId: "integer",
    actualProfileStart: "integer",
    actualProfileEnd: "integer",
    actualProfileName: "text",
    actualLimTransfer: "integer",
    actualLimDownload: "integer",
    actualLimUpload: "integer",
    actualLimUptime: "integer",
  },
  userprofile: {
    id: "integer",
    userId: "integer",
    profileId: "integer",
    price: "number",
    validUntil: "integer",
    added: "integer",
    activated: "integer",
    state: "integer",
    endTime: "integer",
  },
  ucounters: {
    id: "integer",
    userId: "integer",
    uprofileId: "integer",
    download: "integer",
    upload: "integer",
    uptime: "integer",
  },
};
/** Declared types by SQLite affinity; text arrives as BLOB on RouterOS, so BLOB is text too. */
const accepts = (kind: Kind, declared: string) => {
  const type = declared.toUpperCase();
  if (kind === "text") return type === "" || /CHAR|CLOB|TEXT|BLOB/.test(type);
  if (/INT/.test(type)) return true;
  return kind === "number" && /REAL|FLOA|DOUB|NUM|DEC/.test(type);
};
const columns = (table: string) => Object.keys(layout[table]!).join(", ");

export class VoucherSnapshotReader extends Context.Service<
  VoucherSnapshotReader,
  {
    /** Checks and reads a private database copy in a worker thread that exits afterwards. */
    readonly read: (filename: string) => Effect.Effect<DatabaseContents, VoucherSnapshotReadError>;
  }
>()("madar/vouchers/VoucherSnapshotReader") {}

const decoder = new TextDecoder("utf-8", { fatal: true });
class BadValue extends Error {}
const text = (value: unknown) => {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) {
    try {
      return decoder.decode(value);
    } catch {
      throw new BadValue();
    }
  }
  if (value === null) return "";
  throw new BadValue();
};
const integer = (value: unknown) => {
  if (value === null) return 0;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "bigint" && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(value);
  throw new BadValue();
};
const price = (value: unknown) => {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new BadValue();
};
/** Epoch seconds read as router wall-clock time; zero means not set. Lab: confirm the zone. */
const time = (seconds: number) => (seconds > 0 ? epochToNaive(seconds * 1000) : null);

type Row = Record<string, unknown>;

const read = Effect.fn("VoucherSnapshotReader.read")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const pages = Effect.fnUntraced(function* (
    table: string,
    query: (after: number) => Effect.Effect<readonly Row[], SqlError>,
    each: (row: Row) => void,
  ) {
    let after = -1;
    while (true) {
      const rows = yield* query(after).pipe(
        Effect.mapError(() => new VoucherSnapshotReadError({ reason: "corrupt", table })),
      );
      for (const row of rows) {
        try {
          each(row);
        } catch (error) {
          if (error instanceof BadValue)
            return yield* new VoucherSnapshotReadError({ reason: "values", table });
          throw error;
        }
      }
      if (rows.length < READ_BATCH) return;
      after = integer(rows.at(-1)!.id);
    }
  });
  return yield* Effect.gen(function* () {
    const check = yield* sql<{ integrity_check: string }>`PRAGMA integrity_check`.pipe(
      Effect.mapError(() => new VoucherSnapshotReadError({ reason: "corrupt" })),
    );
    if (check.length !== 1 || check[0]?.integrity_check !== "ok")
      return yield* new VoucherSnapshotReadError({ reason: "corrupt" });
    for (const [table, expected] of Object.entries(layout)) {
      const info = yield* sql<{
        name: string;
        type: string;
      }>`SELECT name, type FROM pragma_table_info(${table})`.pipe(
        Effect.mapError(() => new VoucherSnapshotReadError({ reason: "corrupt", table })),
      );
      const declared = new Map(info.map((column) => [column.name, column.type]));
      for (const [column, kind] of Object.entries(expected)) {
        const type = declared.get(column);
        if (type === undefined || !accepts(kind, type))
          return yield* new VoucherSnapshotReadError({ reason: "schema", table });
      }
    }

    const customers = new Map<number, string>();
    yield* pages(
      "customer",
      (after) =>
        sql.unsafe<Row>(
          `SELECT ${columns("customer")} FROM customer WHERE id > ? ORDER BY id LIMIT ${READ_BATCH}`,
          [after],
        ),
      (row) => customers.set(integer(row.id), text(row.login)),
    );
    const profiles = new Map<number, string>();
    yield* pages(
      "profile",
      (after) =>
        sql.unsafe<Row>(
          `SELECT ${columns("profile")} FROM profile WHERE id > ? ORDER BY id LIMIT ${READ_BATCH}`,
          [after],
        ),
      (row) => profiles.set(integer(row.id), text(row.name)),
    );
    const usage = new Map<number, { download: number; upload: number; uptime: number }>();
    const totals = new Map<number, { download: number; upload: number; uptime: number }>();
    const add = (
      map: Map<number, { download: number; upload: number; uptime: number }>,
      key: number,
      row: Row,
    ) => {
      const sum = map.get(key) ?? { download: 0, upload: 0, uptime: 0 };
      sum.download += integer(row.download);
      sum.upload += integer(row.upload);
      sum.uptime += integer(row.uptime);
      map.set(key, sum);
    };
    // Summed in the worker: a large router keeps millions of counter rows, and moving each to
    // the main thread costs seconds of event-loop time. One row per assignment crosses over.
    const sums = yield* sql
      .unsafe<Row>(
        `SELECT uprofileId, userId, SUM(download) AS download, SUM(upload) AS upload,
          SUM(uptime) AS uptime, SUM(${["download", "upload", "uptime"]
            .map((column) => `typeof(${column}) NOT IN ('integer', 'null') OR ${column} < 0`)
            .join(" OR ")}) AS bad
        FROM ucounters GROUP BY uprofileId, userId`,
      )
      .pipe(
        Effect.mapError(
          () => new VoucherSnapshotReadError({ reason: "corrupt", table: "ucounters" }),
        ),
      );
    try {
      for (const row of sums) {
        if (integer(row.bad) > 0) throw new BadValue();
        add(usage, integer(row.uprofileId), row);
        add(totals, integer(row.userId), row);
      }
    } catch (error) {
      if (error instanceof BadValue)
        return yield* new VoucherSnapshotReadError({ reason: "values", table: "ucounters" });
      throw error;
    }
    const assignments = new Map<number, (DatabaseAssignment & { profileId: number })[]>();
    yield* pages(
      "userprofile",
      (after) =>
        sql.unsafe<Row>(
          `SELECT ${columns("userprofile")} FROM userprofile WHERE id > ? ORDER BY id LIMIT ${READ_BATCH}`,
          [after],
        ),
      (row) => {
        const id = integer(row.id);
        const profileId = integer(row.profileId);
        const end = integer(row.endTime) || integer(row.validUntil);
        const list = assignments.get(integer(row.userId)) ?? [];
        list.push({
          id,
          profileId,
          profile: profiles.get(profileId) ?? "",
          assignedAt: time(integer(row.added)),
          startedAt: time(integer(row.activated)),
          endsAt: time(end),
          state: row.state === null ? null : integer(row.state),
          price: price(row.price),
          usage: usage.get(id) ?? { download: 0, upload: 0, uptime: 0 },
        });
        assignments.set(integer(row.userId), list);
      },
    );
    const users: DatabaseUser[] = [];
    let skipped = 0;
    yield* pages(
      "user",
      (after) =>
        sql.unsafe<Row>(
          `SELECT ${columns("user")} FROM user WHERE id > ? ORDER BY id LIMIT ${READ_BATCH}`,
          [after],
        ),
      (row) => {
        const id = integer(row.id);
        const customer = customers.get(integer(row.custId));
        const username = text(row.userName);
        const lifetime = {
          download: integer(row.downloadUsed),
          upload: integer(row.uploadUsed),
          uptime: integer(row.uptimeUsed),
        };
        const counted = totals.get(id) ?? { download: 0, upload: 0, uptime: 0 };
        // Per-package counters can never exceed the lifetime counters they add up to.
        if (
          customer === undefined ||
          !username ||
          counted.download > lifetime.download ||
          counted.upload > lifetime.upload ||
          counted.uptime > lifetime.uptime
        ) {
          skipped++;
          return;
        }
        const own = (assignments.get(id) ?? []).toSorted(
          (left, right) =>
            (right.startedAt ?? right.assignedAt ?? "").localeCompare(
              left.startedAt ?? left.assignedAt ?? "",
            ) || right.id - left.id,
        );
        const profile = text(row.actualProfileName);
        const start = integer(row.actualProfileStart);
        const found = profile ? currentAssignment(own, integer(row.actualProfileId), start) : null;
        users.push({
          id,
          customer,
          username,
          lifetime,
          profile,
          quotaSignature: [
            row.actualLimTransfer,
            row.actualLimDownload,
            row.actualLimUpload,
            row.actualLimUptime,
          ]
            .map(integer)
            .join(":"),
          current: found && {
            ...found,
            startedAt: time(start) ?? found.startedAt,
            endsAt: time(integer(row.actualProfileEnd)) ?? found.endsAt,
          },
          assignments: own.map((item) => ({
            id: item.id,
            profile: item.profile,
            assignedAt: item.assignedAt,
            startedAt: item.startedAt,
            endsAt: item.endsAt,
            state: item.state,
            price: item.price,
            usage: item.usage,
          })),
        });
      },
    );
    return { users, skipped };
  }).pipe(sql.withTransaction, NodeSqliteClient.readOnly);
});

/**
 * The assignment User Manager is running now: the one of the current profile that started at
 * the user's recorded start, else the only latest-started one. Ties are ambiguous: no match.
 */
function currentAssignment<A extends { profileId: number; startedAt: string | null }>(
  assignments: readonly A[],
  profileId: number,
  start: number,
): A | null {
  const candidates = assignments.filter(
    (item) => item.profileId === profileId && item.startedAt !== null,
  );
  const exact = start > 0 ? candidates.filter((item) => item.startedAt === time(start)) : [];
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const latest = candidates[0];
  if (!latest) return null;
  return candidates.filter((item) => item.startedAt === latest.startedAt).length === 1
    ? latest
    : null;
}

export const layer = Layer.succeed(
  VoucherSnapshotReader,
  VoucherSnapshotReader.of({
    read: (filename) =>
      read().pipe(
        Effect.provide(
          NodeSqliteClient.layer({
            filename,
            readonly: true,
            allowExtension: false,
            readerWorker: true,
            privateCopy: true,
          }),
        ),
        Effect.catchTags({
          SqlError: () => Effect.fail(new VoucherSnapshotReadError({ reason: "corrupt" })),
        }),
      ),
  }),
);
