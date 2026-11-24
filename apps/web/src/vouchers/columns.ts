import * as Schema from "effect/Schema";
import { VoucherSort, type VoucherSortField } from "@madar/contracts";

/** Router fields that sort but are shown inside another column. */
const sortOnly = {
  comment: { label: "Comment", group: "default" },
  macBind: { label: "Locks to the first device", group: "subscription" },
  activeFlag: { label: "Router flag A", group: "subscription" },
  incompleteFlag: { label: "Router flag I", group: "subscription" },
} as const;
type SortOnly = keyof typeof sortOnly;
export const sortOnlyFields = Object.keys(sortOnly) as SortOnly[];
export const sortOnlyGroup = (field: SortOnly) => sortOnly[field].group;
export type ColumnKey = Exclude<VoucherSortField, SortOnly | "custom">;
export type ColumnGroup = "default" | "usage" | "subscription" | "subscriber" | "madar";
export interface ColumnDefinition {
  readonly key: ColumnKey;
  readonly label: string;
  readonly group: ColumnGroup;
  readonly align: "start" | "end";
  /** Shown under the label in the Columns popover; for values that are not plain router fields. */
  readonly note?: string;
}

export const columnDefinitions: readonly ColumnDefinition[] = [
  { key: "username", label: "Username", group: "default", align: "start" },
  { key: "state", label: "State", group: "default", align: "start" },
  { key: "profile", label: "Profile", group: "default", align: "start" },
  {
    key: "remaining",
    label: "Remaining",
    group: "default",
    align: "start",
    note: "Calculated by Madar",
  },
  {
    key: "dataUsed",
    label: "Data used",
    group: "default",
    align: "end",
    note: "Download plus upload",
  },
  { key: "uptime", label: "Uptime", group: "default", align: "end" },
  { key: "lastSeen", label: "Last seen", group: "default", align: "start" },
  { key: "download", label: "Download", group: "usage", align: "end" },
  { key: "upload", label: "Upload", group: "usage", align: "end" },
  { key: "activeSessions", label: "Active sessions", group: "usage", align: "end" },
  {
    key: "created",
    label: "Created",
    group: "subscription",
    align: "start",
    note: "Router field, experimental",
  },
  { key: "price", label: "Price", group: "subscription", align: "end", note: "From the profile" },
  { key: "quota", label: "Quota", group: "subscription", align: "start", note: "From the profile" },
  { key: "sharedUsers", label: "Shared users", group: "subscription", align: "end" },
  { key: "macLock", label: "MAC lock", group: "subscription", align: "start" },
  { key: "ipAddress", label: "IP address", group: "subscription", align: "start" },
  { key: "ipv6Dns", label: "IPv6 DNS", group: "subscription", align: "start" },
  { key: "ipv6Prefix", label: "IPv6 prefix", group: "subscription", align: "start" },
  { key: "wireless", label: "Wireless encryption", group: "subscription", align: "start" },
  { key: "flags", label: "Router flags", group: "subscription", align: "start" },
  { key: "firstName", label: "First name", group: "subscriber", align: "start" },
  { key: "lastName", label: "Last name", group: "subscriber", align: "start" },
  { key: "phone", label: "Phone", group: "subscriber", align: "start" },
  { key: "email", label: "Email", group: "subscriber", align: "start" },
  { key: "location", label: "Location", group: "subscriber", align: "start" },
  { key: "firstSeen", label: "First seen", group: "madar", align: "start" },
  { key: "changed", label: "Last change", group: "madar", align: "start" },
  { key: "firstLogin", label: "First login", group: "madar", align: "start" },
  { key: "batch", label: "Batch", group: "madar", align: "start" },
];
export const columnGroups: readonly { group: ColumnGroup; label: string }[] = [
  { group: "default", label: "Main" },
  { group: "usage", label: "Usage" },
  { group: "subscription", label: "Subscription" },
  { group: "subscriber", label: "Subscriber" },
  { group: "madar", label: "Saved by Madar" },
];
const byKey = new Map(columnDefinitions.map((column) => [column.key, column]));
export const columnOf = (key: ColumnKey) => byKey.get(key)!;
export const sortLabel = (field: Exclude<VoucherSortField, "custom">) =>
  field in sortOnly ? sortOnly[field as SortOnly].label : columnOf(field as ColumnKey).label;

export const DEFAULT_COLUMNS: readonly ColumnKey[] = columnDefinitions
  .filter((column) => column.group === "default")
  .map((column) => column.key);
export const DEFAULT_SORT = { field: "username", direction: "asc" } as const;

export const VOUCHER_LAYOUT_KEY = "madar:voucher-layout";
/** Column keys stay plain strings so a removed or renamed key is dropped, not a decode failure. */
export const VoucherLayout = Schema.Struct({
  version: Schema.Literal(1),
  columns: Schema.Array(Schema.String.check(Schema.isMaxLength(64))).check(Schema.isMaxLength(200)),
  sort: Schema.Struct({ field: Schema.String, direction: Schema.Literals(["asc", "desc"]) }),
});
export type VoucherLayout = typeof VoucherLayout.Type;
export const DEFAULT_LAYOUT: VoucherLayout = {
  version: 1,
  columns: DEFAULT_COLUMNS,
  sort: DEFAULT_SORT,
};
const isSortField = Schema.is(VoucherSort.fields.field);

/** A local field shown as a column; the number is the field's id. */
export type FieldColumn = `field:${number}`;
export type ColumnId = ColumnKey | FieldColumn;
export const fieldColumn = (id: number): FieldColumn => `field:${id}`;
export function fieldIdOf(column: string): number | null {
  const match = /^field:([1-9]\d{0,9})$/.exec(column);
  return match ? Number(match[1]) : null;
}
/** The sort the table shows: a router or Madar field, or a local field column. */
export interface ViewSort {
  readonly field: Exclude<VoucherSortField, "custom"> | FieldColumn;
  readonly direction: VoucherSort["direction"];
}
export function querySort(sort: ViewSort): VoucherSort {
  const fieldId = fieldIdOf(sort.field);
  return fieldId === null
    ? { field: sort.field as Exclude<VoucherSortField, "custom">, direction: sort.direction }
    : { field: "custom", fieldId, direction: sort.direction };
}

/**
 * Known, unique column keys with Username first; an unknown sort falls back to the default.
 * Local field columns are kept until the field list is loaded (`fieldIds` null), then only if
 * the field still exists.
 */
export function normalizeLayout(
  layout: VoucherLayout,
  fieldIds: ReadonlySet<number> | null = null,
) {
  const known = (key: string): key is ColumnId => {
    const fieldId = fieldIdOf(key);
    return fieldId === null
      ? byKey.has(key as ColumnKey)
      : fieldIds === null || fieldIds.has(fieldId);
  };
  const columns: ColumnId[] = [
    "username",
    ...new Set(layout.columns.filter((key) => key !== "username" && known(key))),
  ].filter((key): key is ColumnId => known(key));
  const field = layout.sort.field;
  const sort: ViewSort =
    fieldIdOf(field) !== null
      ? known(field)
        ? { field: field as FieldColumn, direction: layout.sort.direction }
        : DEFAULT_SORT
      : isSortField(field) && field !== "custom"
        ? { field, direction: layout.sort.direction }
        : DEFAULT_SORT;
  return { columns, sort };
}

/** Moves within the shown columns. Username stays first. */
export function moveColumn<T extends string>(columns: readonly T[], key: T, to: number) {
  const from = columns.indexOf(key);
  if (from <= 0) return columns;
  const target = Math.max(1, Math.min(columns.length - 1, to));
  if (target === from) return columns;
  const next = columns.filter((item) => item !== key);
  next.splice(target, 0, key);
  return next;
}

/** "Left" and "right" follow what the operator sees, so RTL reverses them. */
export function moveColumnVisually<T extends string>(
  columns: readonly T[],
  key: T,
  side: "left" | "right",
  direction: "ltr" | "rtl",
) {
  const step = (side === "right") === (direction === "ltr") ? 1 : -1;
  return moveColumn(columns, key, columns.indexOf(key) + step);
}
