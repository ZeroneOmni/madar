import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  VoucherFailure,
  type VoucherField,
  type VoucherFieldDraft,
  type VoucherFieldValue,
  type VoucherFieldValues,
} from "@madar/contracts";
import { routerKey } from "../routers/RouterApi.ts";

const isVoucherFailure = Schema.is(VoucherFailure);
const fail = (reason: VoucherFailure["reason"]) => new VoucherFailure({ reason });
const toFailure = (error: unknown) => (isVoucherFailure(error) ? error : fail("storage"));
/** A real calendar date; "2026-02-30" rolls over when parsed, so it fails the round trip. */
const isLocalDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = DateTime.make(`${value}T00:00:00Z`);
  return Option.isSome(parsed) && DateTime.formatIsoDate(parsed.value) === value;
};

/** The typed column for one value, or null when the value does not fit the field. */
function valueColumns(field: Pick<VoucherField, "type" | "choices">, value: VoucherFieldValue) {
  const empty = {
    text_value: null as string | null,
    number_value: null as number | null,
    date_value: null as string | null,
    bool_value: null as number | null,
    choice_id: null as number | null,
  };
  switch (field.type) {
    case "text":
      return typeof value === "string" && value.trim() ? { ...empty, text_value: value } : null;
    case "number":
      return typeof value === "number" ? { ...empty, number_value: value } : null;
    case "date":
      return typeof value === "string" && isLocalDate(value)
        ? { ...empty, date_value: value }
        : null;
    case "boolean":
      return typeof value === "boolean" ? { ...empty, bool_value: Number(value) } : null;
    case "choice":
      return typeof value === "number" && field.choices.some((choice) => choice.id === value)
        ? { ...empty, choice_id: value }
        : null;
  }
}

export class VoucherFieldStore extends Context.Service<
  VoucherFieldStore,
  {
    readonly list: () => Effect.Effect<readonly VoucherField[], VoucherFailure>;
    readonly save: (
      draft: VoucherFieldDraft,
    ) => Effect.Effect<readonly VoucherField[], VoucherFailure>;
    readonly reorder: (
      ids: readonly number[],
    ) => Effect.Effect<readonly VoucherField[], VoucherFailure>;
    readonly remove: (id: number) => Effect.Effect<readonly VoucherField[], VoucherFailure>;
    readonly setValues: (
      input: VoucherFieldValues,
    ) => Effect.Effect<{ readonly updated: number }, VoucherFailure>;
  }
>()("madar/vouchers/VoucherFieldStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const list = Effect.fn("VoucherFieldStore.list")(function* () {
    const fields = yield* sql<{
      id: number;
      name: string;
      type: VoucherField["type"];
      value_count: number;
    }>`SELECT f.id, f.name, f.type,
        (SELECT COUNT(*) FROM voucher_field_values v WHERE v.field_id = f.id) AS value_count
      FROM voucher_fields f ORDER BY f.position, f.id`;
    const choices = yield* sql<{
      id: number;
      field_id: number;
      label: string;
    }>`SELECT id, field_id, label FROM voucher_field_choices ORDER BY position, id`;
    return fields.map((field) => ({
      id: field.id,
      name: field.name,
      type: field.type,
      valueCount: field.value_count,
      choices: choices
        .filter((choice) => choice.field_id === field.id)
        .map((choice) => ({ id: choice.id, label: choice.label })),
    }));
  }, Effect.mapError(toFailure));

  const save = Effect.fn("VoucherFieldStore.save")(function* (draft: VoucherFieldDraft) {
    const labels = draft.choices.map((choice) => choice.label.trim());
    if (
      !draft.name.trim() ||
      labels.some((label) => !label) ||
      new Set(labels).size !== labels.length ||
      (draft.type === "choice") !== labels.length > 0
    )
      return yield* fail("rejected");
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const clash = yield* sql<{
          id: number;
        }>`SELECT id FROM voucher_fields WHERE name = ${draft.name.trim()}`;
        if (clash.some((row) => row.id !== draft.id)) return yield* fail("conflict");
        let id = draft.id;
        if (id === undefined) {
          const created = yield* sql<{ id: number }>`INSERT INTO voucher_fields ${sql.insert({
            name: draft.name.trim(),
            type: draft.type,
            position: 0,
            created_at: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
          })} RETURNING id`;
          id = created[0]!.id;
          yield* sql`UPDATE voucher_fields SET position = (SELECT COALESCE(MAX(position), 0) + 1 FROM voucher_fields) WHERE id = ${id}`;
        } else {
          const existing = yield* sql<{
            type: string;
          }>`SELECT type FROM voucher_fields WHERE id = ${id}`;
          if (!existing[0]) return yield* fail("not-found");
          // A field's type is fixed; changing it would orphan every saved value.
          if (existing[0].type !== draft.type) return yield* fail("rejected");
          yield* sql`UPDATE voucher_fields SET name = ${draft.name.trim()} WHERE id = ${id}`;
        }
        const kept = draft.choices.flatMap((choice) =>
          choice.id === undefined ? [] : [choice.id],
        );
        // Removed choices take their saved values with them through the foreign key.
        yield* kept.length
          ? sql`DELETE FROM voucher_field_choices WHERE field_id = ${id} AND NOT (${sql.in("id", kept)})`
          : sql`DELETE FROM voucher_field_choices WHERE field_id = ${id}`;
        // Temporary labels avoid UNIQUE(field_id, label) clashes while choices swap names.
        for (const [position, choice] of draft.choices.entries())
          if (choice.id !== undefined)
            yield* sql`UPDATE voucher_field_choices SET label = ${`\u0000${position}`} WHERE id = ${choice.id} AND field_id = ${id}`;
        for (const [position, choice] of draft.choices.entries())
          if (choice.id === undefined)
            yield* sql`INSERT INTO voucher_field_choices (field_id, label, position) VALUES (${id}, ${choice.label.trim()}, ${position})`;
          else
            yield* sql`UPDATE voucher_field_choices SET label = ${choice.label.trim()}, position = ${position} WHERE id = ${choice.id} AND field_id = ${id}`;
      }),
    );
    return yield* list();
  }, Effect.mapError(toFailure));

  const reorder = Effect.fn("VoucherFieldStore.reorder")(function* (ids: readonly number[]) {
    yield* sql.withTransaction(
      Effect.forEach(
        ids,
        (id, position) =>
          sql`UPDATE voucher_fields SET position = ${position + 1} WHERE id = ${id}`,
        { discard: true },
      ),
    );
    return yield* list();
  }, Effect.mapError(toFailure));

  const remove = Effect.fn("VoucherFieldStore.remove")(function* (id: number) {
    yield* sql`DELETE FROM voucher_fields WHERE id = ${id}`;
    return yield* list();
  }, Effect.mapError(toFailure));

  const setValues = Effect.fn("VoucherFieldStore.setValues")(function* (input: VoucherFieldValues) {
    const key = routerKey(input.router);
    const fields = new Map((yield* list()).map((field) => [field.id, field]));
    const writes = input.values.map(({ fieldId, value }) => {
      const field = fields.get(fieldId);
      return {
        fieldId,
        columns: field && value !== null ? valueColumns(field, value) : null,
        field,
      };
    });
    if (
      writes.some(
        (write, index) => !write.field || (input.values[index]!.value !== null && !write.columns),
      )
    )
      return yield* fail("rejected");
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const vouchers = yield* sql<{
          id: string;
          username: string;
        }>`SELECT id, username FROM voucher_cache WHERE router_key = ${key}
          AND customer = ${input.customer} AND ${sql.in("id", input.ids)}`;
        const rows = vouchers.flatMap((voucher) =>
          writes.flatMap((write) =>
            write.columns
              ? [
                  {
                    field_id: write.fieldId,
                    router_key: key,
                    customer: input.customer,
                    username: voucher.username,
                    router_id: voucher.id,
                    ...write.columns,
                  },
                ]
              : [],
          ),
        );
        const cleared = writes.filter((write) => !write.columns).map((write) => write.fieldId);
        for (const voucher of vouchers)
          if (cleared.length)
            yield* sql`DELETE FROM voucher_field_values WHERE router_key = ${key}
              AND customer = ${input.customer} AND username = ${voucher.username}
              AND ${sql.in("field_id", cleared)}`;
        for (let start = 0; start < rows.length; start += 100)
          yield* sql`INSERT OR REPLACE INTO voucher_field_values ${sql.insert(rows.slice(start, start + 100))}`;
        return { updated: vouchers.length };
      }),
    );
  }, Effect.mapError(toFailure));

  return VoucherFieldStore.of({ list, save, reorder, remove, setValues });
});
export const layer = Layer.effect(VoucherFieldStore, make);
