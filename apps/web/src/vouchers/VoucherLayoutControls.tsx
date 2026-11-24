import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { VoucherField } from "@madar/contracts";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  Columns3,
  GripVertical,
  Lock,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../components/ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useLocale } from "../useLocale";
import { cn } from "../lib/utils";
import {
  columnDefinitions,
  columnGroups,
  columnOf,
  DEFAULT_COLUMNS,
  DEFAULT_SORT,
  fieldColumn,
  fieldIdOf,
  moveColumn,
  sortLabel,
  sortOnlyFields,
  sortOnlyGroup,
  type ColumnId,
  type ColumnKey,
  type ViewSort,
} from "./columns";

export function ColumnsPopover({
  columns,
  fields,
  onColumns,
  onAnnounce,
  onManageFields,
}: {
  columns: readonly ColumnId[];
  fields: readonly VoucherField[];
  onColumns: (columns: readonly ColumnId[]) => void;
  onAnnounce: (message: string) => void;
  onManageFields: (adding: boolean) => void;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  // The fields dialog replaces the popover rather than opening beneath it.
  const manage = (adding: boolean) => {
    setOpen(false);
    onManageFields(adding);
  };
  const [drag, setDrag] = useState<{ key: ColumnId; order: readonly ColumnId[] } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const query = search.trim().toLocaleLowerCase(locale);
  const fieldOf = (key: ColumnId) => fields.find((field) => fieldColumn(field.id) === key);
  const name = (key: ColumnId) => fieldOf(key)?.name ?? t(columnOf(key as ColumnKey).label);
  const matches = (key: ColumnId) =>
    !query ||
    name(key).toLocaleLowerCase(locale).includes(query) ||
    (fieldIdOf(key) === null &&
      columnOf(key as ColumnKey)
        .label.toLowerCase()
        .includes(query));
  const shown = (drag?.order ?? columns).filter(
    (key) => (fieldIdOf(key) === null || fieldOf(key)) && matches(key),
  );
  const hidden = columnDefinitions.filter(
    (column) => !columns.includes(column.key) && matches(column.key),
  );
  const hiddenFields = fields.filter(
    (field) => !columns.includes(fieldColumn(field.id)) && matches(fieldColumn(field.id)),
  );
  const move = (key: ColumnId, to: number) => {
    const next = moveColumn(columns, key, to);
    if (next === columns) return;
    onColumns(next);
    onAnnounce(
      t("{name} moved to position {position} of {count}", {
        name: name(key),
        position: next.indexOf(key) + 1,
        count: next.length,
      }),
    );
  };
  const show = (key: ColumnId, visible: boolean) => {
    onColumns(visible ? [...columns, key] : columns.filter((item) => item !== key));
    onAnnounce(t(visible ? "{name} shown" : "{name} hidden", { name: name(key) }));
  };
  const reorderKeys = (event: KeyboardEvent, key: ColumnId) => {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    move(key, columns.indexOf(key) + (event.key === "ArrowUp" ? -1 : 1));
  };
  // Pointer drag reorders a draft and commits on release; the menu and Alt+arrows do the same.
  const dragTo = (event: PointerEvent) => {
    if (!drag || !list.current) return;
    const items = [...list.current.querySelectorAll<HTMLElement>("[data-column]")];
    const over = items.findIndex((item) => {
      const box = item.getBoundingClientRect();
      return event.clientY < box.top + box.height / 2;
    });
    const target = items[over === -1 ? items.length - 1 : over]?.dataset.column as ColumnId;
    const order = moveColumn(drag.order, drag.key, drag.order.indexOf(target));
    if (order !== drag.order) setDrag({ ...drag, order });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Columns3 />
        {t("Columns")}
      </PopoverTrigger>
      <PopoverPopup width="md" padding="compact" align="end" aria-label={t("Columns")}>
        <div className="flex max-h-[min(30rem,60vh)] flex-col gap-2">
          <Input
            size="sm"
            type="search"
            aria-label={t("Search columns")}
            placeholder={t("Search columns…")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
            <h3
              id={`${id}-shown`}
              className="px-1 pt-1 pb-1 text-xs font-medium text-muted-foreground"
            >
              {t("Shown")}
            </h3>
            <ul ref={list} aria-labelledby={`${id}-shown`} className="space-y-px">
              {shown.map((key) => {
                const locked = key === "username";
                const position = columns.indexOf(key);
                return (
                  <li
                    key={key}
                    data-column={key}
                    onKeyDown={(event) => !locked && reorderKeys(event, key)}
                    className={cn(
                      "flex min-h-8 items-center gap-2 rounded-md ps-1.5 pe-0.5",
                      drag?.key === key && "bg-accent",
                    )}
                  >
                    {locked ? (
                      <Lock
                        aria-label={t("Always shown")}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <Checkbox
                        aria-label={t("Show {name}", { name: name(key) })}
                        checked
                        onCheckedChange={() => show(key, false)}
                      />
                    )}
                    <ColumnName column={key} field={fieldOf(key)} />
                    {!locked && (
                      <>
                        <Button
                          variant="ghost-muted"
                          size="icon-micro"
                          aria-label={t("Reorder {name}. Use Alt with the arrow keys.", {
                            name: name(key),
                          })}
                          disabled={Boolean(query)}
                          onKeyDown={(event) => reorderKeys(event, key)}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.currentTarget.setPointerCapture(event.pointerId);
                            setDrag({ key, order: columns });
                          }}
                          onPointerMove={dragTo}
                          onPointerUp={() => {
                            if (drag) move(key, drag.order.indexOf(key));
                            setDrag(null);
                          }}
                          onPointerCancel={() => setDrag(null)}
                        >
                          <GripVertical />
                        </Button>
                        <Menu>
                          <MenuTrigger
                            render={
                              <Button
                                variant="ghost-muted"
                                size="icon-micro"
                                aria-label={t("{name} column options", { name: name(key) })}
                              />
                            }
                          >
                            <MoreHorizontal />
                          </MenuTrigger>
                          <MenuPopup align="end">
                            <MenuItem
                              disabled={position <= 1}
                              onClick={() => move(key, position - 1)}
                            >
                              {t("Move up")}
                            </MenuItem>
                            <MenuItem
                              disabled={position >= columns.length - 1}
                              onClick={() => move(key, position + 1)}
                            >
                              {t("Move down")}
                            </MenuItem>
                            <MenuItem disabled={position <= 1} onClick={() => move(key, 1)}>
                              {t("Move to start")}
                            </MenuItem>
                            <MenuSeparator />
                            <MenuItem onClick={() => show(key, false)}>{t("Hide column")}</MenuItem>
                          </MenuPopup>
                        </Menu>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            {columnGroups.map(({ group, label }) => {
              const items = hidden.filter((column) => column.group === group);
              if (items.length === 0) return null;
              return (
                <section key={group} aria-labelledby={`${id}-${group}`} className="pt-2">
                  <h3
                    id={`${id}-${group}`}
                    className="px-1 pb-1 text-xs font-medium text-muted-foreground"
                  >
                    {t(group === "default" ? "Available" : label)}
                  </h3>
                  <ul className="space-y-px">
                    {items.map((column) => (
                      <li key={column.key} className="flex min-h-8 items-center gap-2 ps-1.5">
                        <Checkbox
                          aria-label={t("Show {name}", { name: t(column.label) })}
                          checked={false}
                          onCheckedChange={() => show(column.key, true)}
                        />
                        <ColumnName column={column.key} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
            <section aria-labelledby={`${id}-mine`} className="pt-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <h3 id={`${id}-mine`} className="text-xs font-medium text-muted-foreground">
                  {t("My fields")}
                </h3>
                {fields.length > 0 && (
                  <Button variant="ghost" size="xs" onClick={() => manage(false)}>
                    <Settings2 />
                    {t("Manage")}
                  </Button>
                )}
              </div>
              {hiddenFields.length > 0 ? (
                <ul className="space-y-px">
                  {hiddenFields.map((field) => (
                    <li key={field.id} className="flex min-h-8 items-center gap-2 ps-1.5">
                      <Checkbox
                        aria-label={t("Show {name}", { name: field.name })}
                        checked={false}
                        onCheckedChange={() => show(fieldColumn(field.id), true)}
                      />
                      <ColumnName column={fieldColumn(field.id)} field={field} />
                    </li>
                  ))}
                </ul>
              ) : fields.length === 0 && !query ? (
                <p className="px-1 pb-1 text-xs text-muted-foreground">
                  {t("Add your own columns. They are saved on this PC only.")}
                </p>
              ) : null}
            </section>
            {shown.length === 0 && hidden.length === 0 && hiddenFields.length === 0 && (
              <p className="px-1 py-3 text-sm text-muted-foreground">{t("No columns match.")}</p>
            )}
          </div>
          <div className="flex justify-between gap-2 border-t border-border/50 pt-2">
            <Button variant="ghost" size="sm" onClick={() => manage(true)}>
              <Plus />
              {t("Add field")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={columns.join() === DEFAULT_COLUMNS.join()}
              onClick={() => {
                onColumns(DEFAULT_COLUMNS);
                onAnnounce(t("Columns reset to default"));
              }}
            >
              <RotateCcw />
              {t("Reset to default")}
            </Button>
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function ColumnName({ column, field }: { column: ColumnId; field?: VoucherField | undefined }) {
  const { t } = useLocale();
  if (field)
    return (
      <span className="min-w-0 flex-1 truncate text-sm">
        <bdi>{field.name}</bdi>
        <span className="block truncate text-xs text-muted-foreground">
          {t("Saved on this PC")}
        </span>
      </span>
    );
  const definition = columnOf(column as ColumnKey);
  return (
    <span className="min-w-0 flex-1 truncate text-sm">
      {t(definition.label)}
      {definition.note ? (
        <span className="block truncate text-xs text-muted-foreground">{t(definition.note)}</span>
      ) : null}
    </span>
  );
}

const sortGroups: readonly {
  label: string;
  fields: readonly Exclude<ViewSort["field"], `field:${number}`>[];
}[] = [
  { label: "Main", fields: ["username", "comment", ...DEFAULT_COLUMNS.slice(1)] },
  ...columnGroups.slice(1).map(({ group, label }) => ({
    label,
    fields: [
      ...columnDefinitions.filter((column) => column.group === group).map((column) => column.key),
      ...sortOnlyFields.filter((field) => sortOnlyGroup(field) === group),
    ],
  })),
];

export function SortMenu({
  sort,
  columns,
  fields,
  onSort,
  onAnnounce,
}: {
  sort: ViewSort;
  columns: readonly ColumnId[];
  fields: readonly VoucherField[];
  onSort: (sort: ViewSort) => void;
  onAnnounce: (message: string) => void;
}) {
  const { t } = useLocale();
  const nameOf = (key: ViewSort["field"]) => {
    const fieldId = fieldIdOf(key);
    return fieldId === null
      ? t(sortLabel(key as Exclude<ViewSort["field"], `field:${number}`>))
      : (fields.find((item) => item.id === fieldId)?.name ?? "");
  };
  const field = nameOf(sort.field);
  const visible = columns.some((column) => column === sort.field);
  const isDefault = sort.field === DEFAULT_SORT.field && sort.direction === DEFAULT_SORT.direction;
  const arrow = sort.direction === "asc" ? "↑" : "↓";
  const change = (next: ViewSort) => {
    onSort(next);
    onAnnounce(
      t(next.direction === "asc" ? "Sorted by {name}, ascending" : "Sorted by {name}, descending", {
        name: nameOf(next.field),
      }),
    );
  };
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label={t("Sort vouchers: {name}, {direction}", {
              name: field,
              direction: t(sort.direction === "asc" ? "ascending" : "descending"),
            })}
          />
        }
      >
        <ArrowDownUp />
        {visible || isDefault ? t("Sort") : t("Sort: {name} {arrow}", { name: field, arrow })}
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuRadioGroup
          value={sort.direction}
          onValueChange={(direction) =>
            change({ field: sort.field, direction: direction === "desc" ? "desc" : "asc" })
          }
        >
          <MenuRadioItem value="asc" closeOnClick>
            <span className="flex items-center gap-2">
              <ArrowUp className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{t("Ascending")}</span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
          <MenuRadioItem value="desc" closeOnClick>
            <span className="flex items-center gap-2">
              <ArrowDown className="size-4 text-muted-foreground" aria-hidden="true" />
              <span className="flex-1">{t("Descending")}</span>
              <MenuRadioItemIndicator />
            </span>
          </MenuRadioItem>
        </MenuRadioGroup>
        {sortGroups.map((group) => (
          <MenuGroup key={group.label}>
            <MenuSeparator />
            <MenuGroupLabel>{t(group.label)}</MenuGroupLabel>
            <MenuRadioGroup
              value={sort.field}
              onValueChange={(value) =>
                change({ field: value as ViewSort["field"], direction: sort.direction })
              }
            >
              {group.fields.map((item) => (
                <MenuRadioItem key={item} value={item} closeOnClick>
                  <span className="flex items-center gap-2">
                    <span className="flex-1">{t(sortLabel(item))}</span>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        ))}
        {fields.length > 0 && (
          <MenuGroup>
            <MenuSeparator />
            <MenuGroupLabel>{t("My fields")}</MenuGroupLabel>
            <MenuRadioGroup
              value={sort.field}
              onValueChange={(value) =>
                change({ field: value as ViewSort["field"], direction: sort.direction })
              }
            >
              {fields.map((item) => (
                <MenuRadioItem key={item.id} value={fieldColumn(item.id)} closeOnClick>
                  <span className="flex items-center gap-2">
                    <bdi className="flex-1">{item.name}</bdi>
                    <MenuRadioItemIndicator />
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        )}
      </MenuPopup>
    </Menu>
  );
}
