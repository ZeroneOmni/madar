import { useState } from "react";
import type { VoucherField, VoucherRow } from "@madar/contracts";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  EyeOff,
  Filter,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../components/ui/menu";
import { useLocale } from "../useLocale";
import { cn } from "../lib/utils";
import {
  columnOf,
  fieldIdOf,
  moveColumnVisually,
  type ColumnId,
  type ColumnKey,
  type ViewSort,
} from "./columns";
import { FieldValue } from "./VoucherFields";
import { Cell } from "./VoucherCells";

const stickyCell = "sticky z-10 bg-background";
// Opaque tones so sticky cells match the scrolled cells beneath them.
const rowTone = "group-hover/row:bg-muted group-data-selected/row:bg-accent";

function describe(key: ColumnId, fields: ReadonlyMap<number, VoucherField>) {
  const fieldId = fieldIdOf(key);
  const field = fieldId === null ? undefined : fields.get(fieldId);
  if (field) return { field, label: field.name, align: field.type === "number" ? "end" : "start" };
  const column = columnOf(key as ColumnKey);
  return { field: undefined, label: column.label, align: column.align };
}

export function VoucherTable({
  rows,
  columns,
  sort,
  selected,
  onSelection,
  onInspect,
  onSort,
  onColumns,
  onAnnounce,
  fields,
  onFilterField,
}: {
  rows: readonly VoucherRow[];
  columns: readonly ColumnId[];
  sort: ViewSort;
  selected: readonly string[];
  onSelection: (value: string[]) => void;
  onInspect: (row: VoucherRow) => void;
  onSort: (sort: ViewSort) => void;
  onColumns: (columns: readonly ColumnId[]) => void;
  onAnnounce: (message: string) => void;
  fields: ReadonlyMap<number, VoucherField>;
  onFilterField: (field: VoucherField) => void;
}) {
  const { t } = useLocale();
  // A saved field column waits for the field list before it renders.
  const shown = columns.filter((key) => {
    const fieldId = fieldIdOf(key);
    return fieldId === null || fields.has(fieldId);
  });
  const all = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-border/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className={cn(stickyCell, "start-0 w-10 ps-4 pe-1")}>
              <Checkbox
                aria-label={t("Select this page")}
                checked={all}
                onCheckedChange={(checked) =>
                  onSelection(
                    checked
                      ? [...new Set([...selected, ...rows.map((row) => row.id)])].slice(0, 100)
                      : selected.filter((id) => !rows.some((row) => row.id === id)),
                  )
                }
              />
            </th>
            {shown.map((key) => (
              <HeaderCell
                key={key}
                column={key}
                fields={fields}
                onFilterField={onFilterField}
                columns={columns}
                sort={sort}
                onSort={onSort}
                onColumns={onColumns}
                onAnnounce={onAnnounce}
              />
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/40">
          {rows.map((row) => {
            const checked = selected.includes(row.id);
            return (
              <tr key={row.id} data-selected={checked || undefined} className="group/row">
                <td className={cn(stickyCell, "start-0 ps-4 pe-1", rowTone)}>
                  <Checkbox
                    aria-label={t("Select voucher {name}", { name: row.username })}
                    checked={checked}
                    disabled={selected.length >= 100 && !checked}
                    onCheckedChange={(checked) =>
                      onSelection(
                        checked ? [...selected, row.id] : selected.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                {shown.map((key) =>
                  key === "username" ? (
                    <td
                      key={key}
                      className={cn(
                        stickyCell,
                        "start-10 max-w-64 min-w-40 border-e border-border/40 px-3 py-2",
                        rowTone,
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onInspect(row)}
                        className="block max-w-full cursor-pointer truncate rounded-sm text-start font-mono font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset data-voucher-disabled:text-muted-foreground"
                        data-voucher-disabled={row.disabled || undefined}
                      >
                        <bdi dir="ltr">{row.username}</bdi>
                      </button>
                      {row.comment ? (
                        <p className="truncate text-xs text-muted-foreground">
                          <bdi>{row.comment}</bdi>
                        </p>
                      ) : null}
                    </td>
                  ) : (
                    <td
                      key={key}
                      className={cn(
                        "px-3 py-2 whitespace-nowrap",
                        rowTone,
                        describe(key, fields).align === "end"
                          ? "text-end tabular-nums"
                          : "text-start",
                        key === "lastSeen" && "text-muted-foreground tabular-nums",
                      )}
                    >
                      {fieldIdOf(key) === null ? (
                        <Cell column={key as ColumnKey} row={row} />
                      ) : (
                        <FieldValue field={describe(key, fields).field!} row={row} />
                      )}
                    </td>
                  ),
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HeaderCell({
  column,
  columns,
  sort,
  onSort,
  onColumns,
  onAnnounce,
  fields,
  onFilterField,
}: {
  column: ColumnId;
  columns: readonly ColumnId[];
  sort: ViewSort;
  onSort: (sort: ViewSort) => void;
  onColumns: (columns: readonly ColumnId[]) => void;
  onAnnounce: (message: string) => void;
  fields: ReadonlyMap<number, VoucherField>;
  onFilterField: (field: VoucherField) => void;
}) {
  const { t, direction } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const definition = describe(column, fields);
  const label = definition.field ? definition.field.name : t(definition.label);
  const active = sort.field === column;
  const sortTo = (next: ViewSort["direction"]) => {
    onSort({ field: column, direction: next });
    onAnnounce(
      t(next === "asc" ? "Sorted by {name}, ascending" : "Sorted by {name}, descending", {
        name: label,
      }),
    );
  };
  const move = (side: "left" | "right") => {
    const next = moveColumnVisually(columns, column, side, direction);
    if (next === columns) return;
    onColumns(next);
    onAnnounce(
      t("{name} moved to position {position} of {count}", {
        name: label,
        position: next.indexOf(column) + 1,
        count: next.length,
      }),
    );
  };
  const canMove = (side: "left" | "right") =>
    moveColumnVisually(columns, column, side, direction) !== columns;
  const Arrow = sort.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
      className={cn(
        "group/header h-9 px-1.5 font-medium whitespace-nowrap",
        column === "username" && cn(stickyCell, "start-10 border-e border-border/40"),
      )}
    >
      <div
        className={cn(
          "flex items-center gap-0.5",
          definition.align === "end" && "flex-row-reverse",
        )}
      >
        <button
          type="button"
          onClick={() => sortTo(active && sort.direction === "asc" ? "desc" : "asc")}
          className={cn(
            "inline-flex min-w-0 cursor-pointer items-center gap-1 rounded-sm px-1.5 py-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            active && "text-foreground",
          )}
        >
          <span className="truncate">{definition.field ? <bdi>{label}</bdi> : label}</span>
          {active ? (
            <Arrow aria-hidden="true" className="size-3.5 shrink-0" />
          ) : (
            <ArrowUp aria-hidden="true" className="size-3.5 shrink-0 opacity-0" />
          )}
        </button>
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <span
            className={cn(
              "inline-flex opacity-0 group-hover/header:opacity-100 focus-within:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <MenuTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-micro"
                  aria-label={t("{name} column options", { name: label })}
                />
              }
            >
              <MoreHorizontal />
            </MenuTrigger>
          </span>
          <MenuPopup align="start">
            <MenuItem onClick={() => sortTo("asc")}>
              <ArrowUpNarrowWide />
              {t("Sort ascending")}
            </MenuItem>
            <MenuItem onClick={() => sortTo("desc")}>
              <ArrowDownWideNarrow />
              {t("Sort descending")}
            </MenuItem>
            {column !== "username" && (
              <>
                <MenuSeparator />
                <MenuItem disabled={!canMove("left")} onClick={() => move("left")}>
                  <ArrowLeft />
                  {t("Move left")}
                </MenuItem>
                <MenuItem disabled={!canMove("right")} onClick={() => move("right")}>
                  <ArrowRight />
                  {t("Move right")}
                </MenuItem>
                <MenuSeparator />
                {definition.field && (
                  <MenuItem onClick={() => onFilterField(definition.field!)}>
                    <Filter />
                    {t("Filter by this field…")}
                  </MenuItem>
                )}
                <MenuItem
                  onClick={() => {
                    onColumns(columns.filter((key) => key !== column));
                    onAnnounce(t("{name} hidden", { name: label }));
                  }}
                >
                  <EyeOff />
                  {t("Hide column")}
                </MenuItem>
              </>
            )}
          </MenuPopup>
        </Menu>
      </div>
    </th>
  );
}
