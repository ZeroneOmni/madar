// @effect-diagnostics nodeBuiltinImport:off
import * as NodeSqlite from "node:sqlite";

/** Synthetic User Manager v6 data; never copy real subscriber data into fixtures. */
export interface FixtureAssignment {
  readonly id: number;
  readonly profileId: number;
  readonly added?: number;
  readonly activated?: number;
  readonly state?: number;
  readonly endTime?: number;
  readonly validUntil?: number;
  readonly price?: number;
  readonly counters?: readonly { download: number; upload: number; uptime: number }[];
}
export interface FixtureUser {
  readonly id: number;
  readonly custId?: number;
  readonly username: string;
  readonly download?: number;
  readonly upload?: number;
  readonly uptime?: number;
  readonly profileId?: number;
  readonly profileName?: string;
  readonly start?: number;
  readonly end?: number;
  readonly limits?: { transfer?: number; download?: number; upload?: number; uptime?: number };
  readonly assignments?: readonly FixtureAssignment[];
}
export interface FixtureOptions {
  readonly customers?: readonly { id: number; login: string }[];
  readonly profiles?: readonly { id: number; custId?: number; name: string }[];
  readonly users: readonly FixtureUser[];
  /**
   * "trap": reading a secret column raises an error, so any query that selects one fails.
   * "values": secret columns hold plain marker text.
   */
  readonly secrets?: "trap" | "values";
  /** Replaces one table's DDL to model an unknown layout. */
  readonly ddl?: Partial<Record<"user" | "userprofile" | "ucounters", string>>;
}

export const SECRET_MARKER = "fixture-secret-never-read";
const blob = (value: string) => new TextEncoder().encode(value);

/** Writes a rollback-journal SQLite file with the User Manager v6 tables Madar reads. */
export function writeRouterDatabase(filename: string, options: FixtureOptions) {
  // Schema edits below need defensive mode off; this is a disposable test file.
  const db = new NodeSqlite.DatabaseSync(filename, { defensive: false });
  try {
    db.exec("PRAGMA journal_mode = DELETE");
    const secret =
      options.secrets === "values" ? "BLOB" : "BLOB GENERATED ALWAYS AS (NULL) VIRTUAL";
    db.exec(`
      CREATE TABLE customer (id INTEGER PRIMARY KEY, login BLOB, password ${secret});
      CREATE TABLE profile (id INTEGER PRIMARY KEY, custId INTEGER, name BLOB, validity INTEGER,
        startsAt INTEGER, price INTEGER, nameForUser BLOB, sharedUsers INTEGER);
      ${
        options.ddl?.user ??
        `CREATE TABLE user (id INTEGER PRIMARY KEY, custId INTEGER, userName BLOB,
        password ${secret}, regKey ${secret}, wirelessPsk ${secret}, wirelessEncKey ${secret},
        downloadUsed INTEGER, uploadUsed INTEGER, uptimeUsed INTEGER,
        actualProfileId INTEGER, actualProfileStart INTEGER, actualProfileEnd INTEGER,
        actualProfileName BLOB, actualLimDownload INTEGER, actualLimUpload INTEGER,
        actualLimTransfer INTEGER, actualLimUptime INTEGER, profileTillTime INTEGER,
        profileTimeLeft INTEGER, lastSeenAt INTEGER)`
      };
      ${
        options.ddl?.userprofile ??
        `CREATE TABLE userprofile (id INTEGER PRIMARY KEY, userId INTEGER, profileId INTEGER,
        purchaseId INTEGER, price INTEGER, validUntil INTEGER, added INTEGER, activated INTEGER,
        state INTEGER, endTime INTEGER, paused INTEGER)`
      };
      ${
        options.ddl?.ucounters ??
        `CREATE TABLE ucounters (id INTEGER PRIMARY KEY, userId INTEGER, uprofileId INTEGER,
        profilePartId INTEGER, upload INTEGER, download INTEGER, uptime INTEGER)`
      };
      CREATE TABLE session (id INTEGER PRIMARY KEY, userId INTEGER, fromTime INTEGER,
        tillTime INTEGER, download INTEGER, upload INTEGER);
    `);
    const plain = options.secrets === "values";
    db.exec("BEGIN");
    const customer = db.prepare(
      `INSERT INTO customer (id, login${plain ? ", password" : ""}) VALUES (?, ?${plain ? ", ?" : ""})`,
    );
    for (const item of options.customers ?? [{ id: 1, login: "admin" }])
      customer.run(item.id, blob(item.login), ...(plain ? [blob(SECRET_MARKER)] : []));
    const profile = db.prepare("INSERT INTO profile (id, custId, name) VALUES (?, ?, ?)");
    for (const item of options.profiles ?? [])
      profile.run(item.id, item.custId ?? 1, blob(item.name));
    const userColumns = [
      "id",
      "custId",
      "userName",
      "downloadUsed",
      "uploadUsed",
      "uptimeUsed",
      "actualProfileId",
      "actualProfileStart",
      "actualProfileEnd",
      "actualProfileName",
      "actualLimTransfer",
      "actualLimDownload",
      "actualLimUpload",
      "actualLimUptime",
      ...(plain ? ["password", "regKey", "wirelessPsk", "wirelessEncKey"] : []),
    ];
    const user = db.prepare(
      `INSERT INTO user (${userColumns.join(", ")}) VALUES (${userColumns.map(() => "?").join(", ")})`,
    );
    const assignment = db.prepare(
      `INSERT INTO userprofile (id, userId, profileId, price, validUntil, added, activated, state,
        endTime) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const counterSql =
      "INSERT INTO ucounters (userId, uprofileId, profilePartId, upload, download, uptime) VALUES (?, ?, 0, ?, ?, ?)";
    for (const item of options.users) {
      const assignments = item.assignments ?? [];
      const sum = (key: "download" | "upload" | "uptime") =>
        assignments.reduce(
          (total, entry) =>
            total + (entry.counters ?? []).reduce((part, value) => part + value[key], 0),
          0,
        );
      user.run(
        item.id,
        item.custId ?? 1,
        blob(item.username),
        item.download ?? sum("download"),
        item.upload ?? sum("upload"),
        item.uptime ?? sum("uptime"),
        item.profileId ?? 0,
        item.start ?? 0,
        item.end ?? 0,
        blob(item.profileName ?? ""),
        item.limits?.transfer ?? 0,
        item.limits?.download ?? 0,
        item.limits?.upload ?? 0,
        item.limits?.uptime ?? 0,
        ...(plain ? Array.from({ length: 4 }, () => blob(SECRET_MARKER)) : []),
      );
      for (const entry of assignments) {
        assignment.run(
          entry.id,
          item.id,
          entry.profileId,
          entry.price ?? 0,
          entry.validUntil ?? 0,
          entry.added ?? 0,
          entry.activated ?? 0,
          entry.state ?? 0,
          entry.endTime ?? 0,
        );
        for (const value of entry.counters ?? [])
          db.prepare(counterSql).run(item.id, entry.id, value.upload, value.download, value.uptime);
      }
    }
    db.exec("COMMIT");
    if (options.secrets !== "values") {
      // Inserts evaluate generated columns, so the trap goes in after the rows: reading
      // MIN(int64) through abs() overflows, and any query that selects a secret fails.
      db.exec("PRAGMA writable_schema = ON");
      db.exec(`UPDATE sqlite_schema SET sql = replace(sql, 'AS (NULL)',
        'AS (abs(id * 0 - 9223372036854775807 - 1))') WHERE type = 'table'`);
      db.exec("PRAGMA writable_schema = OFF");
    }
  } finally {
    db.close();
  }
}
