// @effect-diagnostics nodeBuiltinImport:off
import * as NodeURL from "node:url";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import * as NodeSqliteClient from "@madar/shared/nodeSqliteClient";
import { epochToNaive } from "./routerValues.ts";

export class VoucherSnapshotReadError extends Schema.TaggedError<VoucherSnapshotReadError>()(
  "VoucherSnapshotReadError",
  {
    /**
     * "corrupt": not an SQLite database. "torn": a table Madar reads is structurally broken or
     * the file ends early, as in a copy taken while User Manager wrote to it.
     */
    reason: Schema.Literals(["corrupt", "torn", "schema", "values"]),
    /** The table whose layout or values were rejected. */
    table: Schema.optional(Schema.String),
    column: Schema.optional(Schema.String),
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
  customer: { id: "integer", userName: "text" },
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
/** Index-only damage from a copy taken mid-write; Madar reads tables by rowid, never by index. */
const indexMessage =
  /^(row \d+ missing from index |wrong # of entries in index |non-unique entry in UNIQUE index )/;

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
const anyInteger = (value: unknown) => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (
    typeof value === "bigint" &&
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  )
    return Number(value);
  throw new BadValue();
};
/** Counters, ids and codes: never negative. */
const integer = (value: unknown) => {
  if (value === null) return 0;
  const number = anyInteger(value);
  if (number < 0) throw new BadValue();
  return number;
};
/** Times, profile ids and limits: User Manager writes -1 or -2 for "not set". */
const optional = (value: unknown) => {
  if (value === null) return null;
  const number = anyInteger(value);
  return number > 0 ? number : null;
};
const price = (value: unknown) => {
  if (value === null) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  throw new BadValue();
};
/** Epoch seconds read as router wall-clock time. Lab: confirm the zone. */
const time = (value: unknown) => {
  const seconds = optional(value);
  return seconds === null ? null : epochToNaive(seconds * 1000);
};

type Row = Record<string, unknown>;
const errorCode = (error: SqlError) => {
  const cause = (error.reason as { cause?: unknown }).cause;
  return Predicate.hasProperty(cause, "errcode") && typeof cause.errcode === "number"
    ? cause.errcode & 0xff
    : null;
};
const SQLITE_NOTADB = 26;
const structural = (table?: string) => (error: SqlError) =>
  new VoucherSnapshotReadError({
    reason: errorCode(error) === SQLITE_NOTADB ? "corrupt" : "torn",
    ...(table ? { table } : {}),
  });

const read = Effect.fn("VoucherSnapshotReader.read")(function* () {
  const sql = yield* SqlClient.SqlClient;
  /**
   * Reads a table by rowid in pages and returns the rows it dropped. A row id seen twice can
   * only come from a torn page, so neither row is trusted.
   */
  const pages = Effect.fnUntraced(function* (table: string, each: (row: Row) => void) {
    const rows = new Map<number, Row>();
    const dropped: Row[] = [];
    let after = -1;
    while (true) {
      const page = yield* sql
        .unsafe<Row>(
          `SELECT ${columns(table)} FROM ${table} NOT INDEXED WHERE id > ? ORDER BY id LIMIT ${READ_BATCH}`,
          [after],
        )
        .pipe(Effect.mapError(structural(table)));
      for (const row of page) {
        const id = Number(row.id);
        const first = rows.get(id);
        if (first) dropped.push(first, row);
        rows.set(id, row);
      }
      if (page.length < READ_BATCH) break;
      after = Number(page.at(-1)!.id);
    }
    const twice = new Set(dropped.map((row) => Number(row.id)));
    try {
      for (const [id, row] of rows) if (!twice.has(id)) each(row);
    } catch (error) {
      if (error instanceof BadValue)
        return yield* new VoucherSnapshotReadError({ reason: "values", table });
      throw error;
    }
    return dropped;
  });
  return yield* Effect.gen(function* () {
    for (const [table, expected] of Object.entries(layout)) {
      const info = yield* sql<{
        name: string;
        type: string;
        pk: number;
      }>`SELECT name, type, pk FROM pragma_table_info(${table})`.pipe(
        Effect.mapError(structural(table)),
      );
      if (info.length === 0)
        return yield* new VoucherSnapshotReadError({ reason: "schema", table });
      const declared = new Map(info.map((column) => [column.name, column]));
      for (const [column, kind] of Object.entries(expected)) {
        const type = declared.get(column)?.type;
        if (type === undefined || !accepts(kind, type))
          return yield* new VoucherSnapshotReadError({ reason: "schema", table, column });
      }
      // Rowid scans need `id` to be the rowid: the table's only key, declared INTEGER exactly.
      const keys = info.filter((column) => column.pk > 0);
      const rowid = yield* sql<{ wr: number }>`SELECT wr FROM pragma_table_list
        WHERE schema = 'main' AND name = ${table}`.pipe(Effect.mapError(structural(table)));
      if (
        keys.length !== 1 ||
        keys[0]!.name !== "id" ||
        keys[0]!.type.toUpperCase() !== "INTEGER" ||
        rowid[0]?.wr !== 0
      )
        return yield* new VoucherSnapshotReadError({ reason: "schema", table, column: "id" });
      yield* checkTable(table);
    }

    const customers = new Map<number, string>();
    const customerTwice = new Set(
      (yield* pages("customer", (row) => customers.set(integer(row.id), text(row.userName)))).map(
        (row) => Number(row.id),
      ),
    );
    const profiles = new Map<number, string>();
    const profileTwice = new Set(
      (yield* pages("profile", (row) => profiles.set(integer(row.id), text(row.name)))).map((row) =>
        Number(row.id),
      ),
    );
    /** By assignment and user: a busy copy may hold counter rows whose user disagrees. */
    const usage = new Map<string, Usage>();
    const totals = new Map<number, Usage>();
    const add = <K>(map: Map<K, Usage>, key: K, row: Row) => {
      const sum = map.get(key) ?? { download: 0, upload: 0, uptime: 0 };
      map.set(key, {
        download: sum.download + integer(row.download),
        upload: sum.upload + integer(row.upload),
        uptime: sum.uptime + integer(row.uptime),
      });
    };
    // Summed in the worker: a large router keeps millions of counter rows, and moving each to
    // the main thread costs seconds of event-loop time. One row per assignment crosses over.
    const sums = yield* sql
      .unsafe<Row>(
        `SELECT uprofileId, userId, SUM(download) AS download, SUM(upload) AS upload,
          SUM(uptime) AS uptime, SUM(${["download", "upload", "uptime"]
            .map((column) => `typeof(${column}) NOT IN ('integer', 'null') OR ${column} < 0`)
            .join(" OR ")}) AS bad
        FROM ucounters NOT INDEXED GROUP BY uprofileId, userId`,
      )
      .pipe(Effect.mapError(structural("ucounters")));
    try {
      for (const row of sums) {
        if (integer(row.bad) > 0) throw new BadValue();
        add(usage, `${integer(row.uprofileId)}:${integer(row.userId)}`, row);
        add(totals, integer(row.userId), row);
      }
    } catch (error) {
      if (error instanceof BadValue)
        return yield* new VoucherSnapshotReadError({ reason: "values", table: "ucounters" });
      throw error;
    }
    /** Users whose assignment rows were seen twice; their packages are uncertain. */
    const uncertain = new Set<number>();
    const assignments = new Map<number, DatabaseAssignment[]>();
    const assignmentsDropped = yield* pages("userprofile", (row) => {
      const id = integer(row.id);
      const userId = integer(row.userId);
      const profileId = integer(row.profileId);
      if (profileTwice.has(profileId)) uncertain.add(userId);
      const list = assignments.get(userId) ?? [];
      list.push({
        id,
        profile: profiles.get(profileId) ?? "",
        assignedAt: time(row.added),
        startedAt: time(row.activated),
        endsAt: time(row.endTime) ?? time(row.validUntil),
        state: row.state === null ? null : integer(row.state),
        price: price(row.price),
        usage: usage.get(`${id}:${userId}`) ?? { download: 0, upload: 0, uptime: 0 },
      });
      assignments.set(userId, list);
    });
    for (const row of assignmentsDropped) uncertain.add(Number(row.userId));
    const users: DatabaseUser[] = [];
    let skipped = 0;
    const usersDropped = yield* pages("user", (row) => {
      const id = integer(row.id);
      const custId = integer(row.custId);
      const customer = customerTwice.has(custId) ? undefined : customers.get(custId);
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
        uncertain.has(id) ||
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
      // On User Manager 6 this names the running userprofile row, not a profile.
      const assignment = optional(row.actualProfileId);
      const start = time(row.actualProfileStart);
      const found = profile ? (own.find((item) => item.id === assignment) ?? null) : null;
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
          .map((value) => optional(value) ?? 0)
          .join(":"),
        current: found && {
          ...found,
          startedAt: start ?? found.startedAt,
          endsAt: time(row.actualProfileEnd) ?? found.endsAt,
        },
        assignments: own,
      });
    });
    return { users, skipped: skipped + new Set(usersDropped.map((row) => row.id)).size };
  }).pipe(sql.withTransaction, NodeSqliteClient.readOnly);
});

/**
 * Fails when the table's own B-tree is damaged. Index trees may be torn in a copy taken while
 * User Manager wrote to it; reads never use them, so their damage is ignored.
 */
const checkTable = Effect.fnUntraced(function* (table: string) {
  const sql = yield* SqlClient.SqlClient;
  const indexRoots = new Set(
    (yield* sql<{ rootpage: number }>`SELECT rootpage FROM sqlite_schema
      WHERE type = 'index' AND tbl_name = ${table}`.pipe(Effect.mapError(structural(table)))).map(
      (row) => row.rootpage,
    ),
  );
  const report = yield* sql
    .unsafe<{ quick_check: string }>(`PRAGMA quick_check(${table})`)
    .pipe(Effect.mapError(structural(table)));
  const damaged = report
    .flatMap((row) => row.quick_check.split("\n"))
    .filter((line) => line !== "ok" && !line.startsWith("*** in database"))
    .some((line) => {
      const tree = /^Tree (\d+) /.exec(line);
      return tree ? !indexRoots.has(Number(tree[1])) : !indexMessage.test(line);
    });
  if (damaged) return yield* new VoucherSnapshotReadError({ reason: "torn", table });
});

/** Immutable: SQLite never looks for a journal beside the copy, so it cannot roll one back. */
const immutable = (filename: string) => {
  const url = NodeURL.pathToFileURL(filename);
  url.searchParams.set("immutable", "1");
  return url.href;
};

export const layer = Layer.succeed(
  VoucherSnapshotReader,
  VoucherSnapshotReader.of({
    read: (filename) =>
      read().pipe(
        Effect.provide(
          NodeSqliteClient.layer({
            filename: immutable(filename),
            readonly: true,
            allowExtension: false,
            readerWorker: true,
            privateCopy: true,
          }),
        ),
        Effect.catchTags({ SqlError: (error) => Effect.fail(structural()(error)) }),
      ),
  }),
);
