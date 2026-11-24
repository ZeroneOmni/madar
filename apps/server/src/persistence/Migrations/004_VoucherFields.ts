import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Operator-defined fields, saved only in Madar and never sent to the router.
  // AUTOINCREMENT: saved layouts and filters keep field and choice ids after a delete.
  yield* sql`CREATE TABLE voucher_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    type TEXT NOT NULL CHECK (type IN ('text', 'number', 'date', 'boolean', 'choice')),
    position INTEGER NOT NULL, created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE TABLE voucher_field_choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    field_id INTEGER NOT NULL REFERENCES voucher_fields(id) ON DELETE CASCADE,
    label TEXT NOT NULL, position INTEGER NOT NULL,
    UNIQUE(field_id, label)
  )`;
  // Typed EAV: one value column per type, exactly one set. Keyed like other Madar voucher data.
  yield* sql`CREATE TABLE voucher_field_values (
    field_id INTEGER NOT NULL REFERENCES voucher_fields(id) ON DELETE CASCADE,
    router_key TEXT NOT NULL, customer TEXT NOT NULL, username TEXT NOT NULL,
    router_id TEXT NOT NULL,
    text_value TEXT, number_value REAL, date_value TEXT,
    bool_value INTEGER CHECK (bool_value IN (0, 1)),
    choice_id INTEGER REFERENCES voucher_field_choices(id) ON DELETE CASCADE,
    PRIMARY KEY(field_id, router_key, customer, username),
    CHECK ((text_value IS NOT NULL) + (number_value IS NOT NULL) + (date_value IS NOT NULL)
      + (bool_value IS NOT NULL) + (choice_id IS NOT NULL) = 1)
  ) WITHOUT ROWID`;
  yield* sql`CREATE INDEX voucher_field_values_voucher ON voucher_field_values(router_key, customer, username)`;
  // The value column must match the field's type, and a choice must belong to its field.
  for (const event of ["INSERT", "UPDATE"])
    yield* sql.unsafe(`CREATE TRIGGER voucher_field_values_type_${event.toLowerCase()}
      BEFORE ${event} ON voucher_field_values
      WHEN (SELECT type FROM voucher_fields WHERE id = NEW.field_id) IS NOT
        CASE WHEN NEW.text_value IS NOT NULL THEN 'text'
          WHEN NEW.number_value IS NOT NULL THEN 'number'
          WHEN NEW.date_value IS NOT NULL THEN 'date'
          WHEN NEW.bool_value IS NOT NULL THEN 'boolean'
          ELSE 'choice' END
        OR (NEW.choice_id IS NOT NULL
          AND (SELECT field_id FROM voucher_field_choices WHERE id = NEW.choice_id) IS NOT NEW.field_id)
      BEGIN SELECT RAISE(ABORT, 'voucher field value does not match its field'); END`);
});
