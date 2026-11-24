import { useId, useState } from "react";
import type {
  VoucherField,
  VoucherFieldFilter,
  VoucherFieldType,
  VoucherFieldValue,
  VoucherRow,
  VoucherScope,
} from "@madar/contracts";
import { ArrowDown, ArrowUp, CircleAlert, HardDrive, Plus, Trash2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Spinner } from "../components/ui/spinner";
import { Textarea } from "../components/ui/textarea";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { Choice } from "../components/Choice";
import { FieldRow, IconAction, Notice } from "../components/WorkspacePage";
import { formatNumber, type Locale } from "../locale";
import { useLocale } from "../useLocale";
import { voucherClient, voucherError } from "./client";

type Translate = ReturnType<typeof useLocale>["t"];
const fieldTypes: readonly { type: VoucherFieldType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "boolean", label: "Yes or no" },
  { type: "choice", label: "Choice from a list" },
];
const typeLabel = (type: VoucherFieldType) =>
  fieldTypes.find((item) => item.type === type)?.label ?? type;

/** Plain text for a saved value, for cells, exports and filter summaries. */
export function formatFieldValue(
  field: VoucherField,
  value: VoucherFieldValue | undefined,
  locale: Locale,
  t: Translate,
): string {
  if (value === undefined) return "";
  switch (field.type) {
    case "number":
      return typeof value === "number"
        ? new Intl.NumberFormat(locale, {
            maximumFractionDigits: 6,
            numberingSystem: locale === "ar" ? "arab" : "latn",
          }).format(value)
        : "";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Intl.DateTimeFormat(locale, {
            numberingSystem: locale === "ar" ? "arab" : "latn",
            calendar: "gregory",
            timeZone: "UTC",
            dateStyle: "medium",
          }).format(Date.parse(`${value}T00:00:00Z`))
        : "";
    case "boolean":
      return value === true ? t("Yes") : value === false ? t("No") : "";
    case "choice":
      return field.choices.find((choice) => choice.id === value)?.label ?? "";
    case "text":
      return typeof value === "string" ? value : "";
  }
}

export function FieldValue({ field, row }: { field: VoucherField; row: VoucherRow }) {
  const { t, locale } = useLocale();
  const text = formatFieldValue(field, row.fields[String(field.id)], locale, t);
  return text ? <bdi>{text}</bdi> : <span className="text-muted-foreground">–</span>;
}

function LocalOnlyNote() {
  const { t } = useLocale();
  return (
    <p className="flex items-start gap-2 text-xs text-muted-foreground">
      <HardDrive aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      {t("Saved on this PC only. Never sent to the router.")}
    </p>
  );
}

/** A typed control; an empty control means "no value". */
function FieldEditor({
  id,
  field,
  value,
  onChange,
  disabled = false,
  onInvalid,
}: {
  id: string;
  field: VoucherField;
  value: VoucherFieldValue | null;
  onChange: (value: VoucherFieldValue | null) => void;
  disabled?: boolean;
  /** An unfinished number (such as "1e") reads as empty; it must not count as a clear. */
  onInvalid?: (invalid: boolean) => void;
}) {
  const { t } = useLocale();
  const [number, setNumber] = useState(typeof value === "number" ? String(value) : "");
  switch (field.type) {
    case "text":
      return (
        <Input
          id={id}
          dir="auto"
          maxLength={512}
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value.trim() ? event.target.value : null)}
        />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          dir="ltr"
          step="any"
          disabled={disabled}
          value={number}
          // An unfinished number in an empty input leaves the value "", so onChange may not fire.
          onInput={(event) => onInvalid?.(event.currentTarget.validity.badInput)}
          onChange={(event) => {
            const invalid = event.target.validity.badInput;
            onInvalid?.(invalid);
            // Kept in sync even while unfinished; otherwise React restores the last valid text
            // and drops what was typed ("1e3" would lose its exponent).
            setNumber(event.target.value);
            if (invalid) return;
            const parsed = Number(event.target.value);
            onChange(event.target.value.trim() && Number.isFinite(parsed) ? parsed : null);
          }}
        />
      );
    case "date":
      return (
        <Input
          id={id}
          type="date"
          dir="ltr"
          disabled={disabled}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || null)}
        />
      );
    case "boolean":
      return (
        <Choice
          label={field.name}
          disabled={disabled}
          value={value === true ? "yes" : value === false ? "no" : ""}
          onChange={(next) => onChange(next === "yes" ? true : next === "no" ? false : null)}
          options={[
            { value: "", label: t("Not set") },
            { value: "yes", label: t("Yes") },
            { value: "no", label: t("No") },
          ]}
        />
      );
    case "choice":
      return (
        <Choice
          label={field.name}
          disabled={disabled}
          value={typeof value === "number" ? String(value) : ""}
          onChange={(next) => onChange(next ? Number(next) : null)}
          options={[
            { value: "", label: t("Not set") },
            ...field.choices.map((choice) => ({ value: String(choice.id), label: choice.label })),
          ]}
        />
      );
  }
}

/** The "My fields" section of the voucher details panel. Works offline: nothing reaches the router. */
export function InspectorFields({
  row,
  scope,
  fields,
  onSaved,
}: {
  row: VoucherRow;
  scope: VoucherScope;
  fields: readonly VoucherField[];
  onSaved: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [draft, setDraft] = useState<Record<string, VoucherFieldValue | null>>({});
  // The row prop is a snapshot from the table; saved values replace it until the panel reopens.
  const [saved, setSaved] = useState<Record<string, VoucherFieldValue | null>>({});
  const initial = (field: VoucherField) =>
    String(field.id) in saved
      ? (saved[String(field.id)] ?? null)
      : (row.fields[String(field.id)] ?? null);
  const [saving, setSaving] = useState(false);
  const [invalid, setInvalid] = useState<ReadonlySet<number>>(new Set());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const changed = fields.filter(
    (field) => String(field.id) in draft && draft[String(field.id)] !== initial(field),
  );
  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    await voucherClient
      .setFieldValues({
        ...scope,
        ids: [row.id],
        values: changed.map((field) => ({
          fieldId: field.id,
          value: draft[String(field.id)] ?? null,
        })),
      })
      .then(
        (result) => {
          if (result.updated === 0) {
            setError("This voucher is no longer saved on this PC. Refresh vouchers and try again.");
            return;
          }
          setSaved((current) => ({ ...current, ...draft }));
          setDraft({});
          setMessage(t("Saved on this PC."));
          onSaved();
        },
        (cause) => setError(voucherError(cause)),
      );
    setSaving(false);
  }
  if (fields.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="px-1 text-sm text-foreground/70">
        {t("My fields")}
      </h3>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
        {fields.map((field) => (
          <FieldRow key={field.id} controlId={`${id}-${field.id}`} label={field.name}>
            <FieldEditor
              id={`${id}-${field.id}`}
              field={field}
              value={String(field.id) in draft ? (draft[String(field.id)] ?? null) : initial(field)}
              onChange={(value) => setDraft((current) => ({ ...current, [field.id]: value }))}
              disabled={saving}
              onInvalid={(bad) =>
                setInvalid((current) => {
                  const next = new Set(current);
                  if (bad) next.add(field.id);
                  else next.delete(field.id);
                  return next;
                })
              }
            />
          </FieldRow>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-1">
        <LocalOnlyNote />
        <div className="ms-auto">
          <Button
            size="sm"
            disabled={changed.length === 0 || saving || invalid.size > 0}
            onClick={() => void save()}
          >
            {saving ? <Spinner aria-hidden="true" role="presentation" /> : null}
            {t("Save my fields")}
          </Button>
        </div>
      </div>
      {invalid.size > 0 && (
        <p className="px-1 text-xs text-destructive">
          {t("Finish the number or clear the field before saving.")}
        </p>
      )}
      <p role="status" className="px-1 text-xs text-muted-foreground">
        {message}
      </p>
      {error && (
        <p role="alert" className="px-1 text-sm text-destructive">
          {t(error)}
        </p>
      )}
    </section>
  );
}

const choiceLines = (text: string) => [
  ...new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  ),
];

/** Create, rename, reorder and delete local fields. Definitions apply to every router. */
export function VoucherFieldsDialog({
  open,
  adding,
  fields,
  onOpenChange,
  onFields,
}: {
  open: boolean;
  adding: boolean;
  fields: readonly VoucherField[];
  onOpenChange: (open: boolean) => void;
  onFields: (fields: readonly VoucherField[]) => void;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [name, setName] = useState("");
  const [type, setType] = useState<VoucherFieldType>("text");
  const [choices, setChoices] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<VoucherField | null>(null);
  const [countChanged, setCountChanged] = useState(false);
  async function run(task: () => Promise<readonly VoucherField[]>) {
    setBusy(true);
    setError("");
    const ok = await task().then(
      (next) => {
        onFields(next);
        return true;
      },
      (cause) => {
        setError(voucherError(cause));
        return false;
      },
    );
    setBusy(false);
    return ok;
  }
  const move = (index: number, step: number) => {
    const ids = fields.map((field) => field.id);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + step, 0, moved!);
    void run(() => voucherClient.reorderFields(ids));
  };
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("My fields")}</DialogTitle>
            <DialogDescription>
              {t(
                "Add your own columns, such as a shop name or a payment date. They apply to every router and customer.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-4">
              <LocalOnlyNote />
              {fields.length > 0 && (
                <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
                  {fields.map((field, index) => (
                    <FieldDefinition
                      key={`${field.id}:${field.name}:${field.choices.map((choice) => choice.label).join()}`}
                      field={field}
                      busy={busy}
                      first={index === 0}
                      last={index === fields.length - 1}
                      onMove={(step) => move(index, step)}
                      onDelete={() => {
                        setCountChanged(false);
                        void voucherClient.fields().then(
                          // Refreshes and deleted vouchers change the count; confirm with today's.
                          (next) => setDeleting(next.find((item) => item.id === field.id) ?? null),
                          (cause) => setError(voucherError(cause)),
                        );
                      }}
                      onSave={(draft) => run(() => voucherClient.saveField(draft))}
                    />
                  ))}
                </ul>
              )}
              <form
                aria-labelledby={`${id}-add`}
                className="space-y-3 rounded-xl border border-border/60 p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() =>
                    voucherClient.saveField({
                      name: name.trim(),
                      type,
                      choices:
                        type === "choice" ? choiceLines(choices).map((label) => ({ label })) : [],
                    }),
                  ).then((ok) => {
                    if (!ok) return;
                    setName("");
                    setChoices("");
                  });
                }}
              >
                <h3 id={`${id}-add`} className="text-sm font-medium">
                  {t("Add a field")}
                </h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("Field name")}</span>
                    <Input
                      autoFocus={adding}
                      dir="auto"
                      required
                      maxLength={64}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <div className="space-y-1 text-xs text-muted-foreground">
                    <span>{t("Type")}</span>
                    <Choice
                      label={t("Type")}
                      value={type}
                      onChange={(next) => setType(next as VoucherFieldType)}
                      options={fieldTypes.map((item) => ({
                        value: item.type,
                        label: t(item.label),
                      }))}
                    />
                  </div>
                </div>
                {type === "choice" && (
                  <label className="block space-y-1 text-xs text-muted-foreground">
                    <span>{t("Choices, one per line")}</span>
                    <Textarea
                      dir="auto"
                      required
                      rows={3}
                      value={choices}
                      onChange={(event) => setChoices(event.target.value)}
                    />
                  </label>
                )}
                <div className="flex justify-end">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busy || !name.trim() || (type === "choice" && !choiceLines(choices).length)
                    }
                  >
                    <Plus />
                    {t("Add field")}
                  </Button>
                </div>
              </form>
              {error && (
                <Notice tone="error" icon={<CircleAlert />} announce>
                  {t(error)}
                </Notice>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("Done")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDeleting(null);
            setCountChanged(false);
          }
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Delete the field {name}?", { name: deleting?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.valueCount
                ? t(
                    "Its values on {count} vouchers will be deleted from this PC. This cannot be undone.",
                    { count: formatNumber(deleting.valueCount, locale) },
                  )
                : t("No voucher has a value in this field yet. This cannot be undone.")}
            </AlertDialogDescription>
            {countChanged && (
              <p role="alert" className="text-sm text-warning-foreground">
                {t("The number of saved values changed. Check the new count and confirm again.")}
              </p>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{t("Cancel")}</AlertDialogClose>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const field = deleting;
                if (!field) return;
                setBusy(true);
                void voucherClient.deleteField(field.id, field.valueCount).then(
                  (next) => {
                    onFields(next);
                    setDeleting(null);
                    setBusy(false);
                  },
                  (cause) =>
                    void voucherClient.fields().then(
                      (next) => {
                        const fresh = next.find((item) => item.id === field.id) ?? null;
                        if (fresh && fresh.valueCount !== field.valueCount) {
                          setDeleting(fresh);
                          setCountChanged(true);
                        } else {
                          setError(voucherError(cause));
                          setDeleting(null);
                        }
                        setBusy(false);
                      },
                      () => {
                        setError(voucherError(cause));
                        setDeleting(null);
                        setBusy(false);
                      },
                    ),
                );
              }}
            >
              {t("Delete field")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

function FieldDefinition({
  field,
  busy,
  first,
  last,
  onMove,
  onDelete,
  onSave,
}: {
  field: VoucherField;
  busy: boolean;
  first: boolean;
  last: boolean;
  onMove: (step: number) => void;
  onDelete: () => void;
  onSave: (draft: Parameters<typeof voucherClient.saveField>[0]) => Promise<boolean>;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [name, setName] = useState(field.name);
  const [choices, setChoices] = useState(field.choices.map((choice) => choice.label).join("\n"));
  const lines = choiceLines(choices);
  const dirty =
    name.trim() !== field.name ||
    (field.type === "choice" && lines.join("\n") !== field.choices.map((c) => c.label).join("\n"));
  return (
    <li className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("Name of {name}", { name: field.name })}
          dir="auto"
          maxLength={64}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <span className="shrink-0 text-xs text-muted-foreground">{t(typeLabel(field.type))}</span>
        <IconAction
          label={t("Move {name} up", { name: field.name })}
          size="icon-xs"
          disabled={busy || first}
          onClick={() => onMove(-1)}
        >
          <ArrowUp />
        </IconAction>
        <IconAction
          label={t("Move {name} down", { name: field.name })}
          size="icon-xs"
          disabled={busy || last}
          onClick={() => onMove(1)}
        >
          <ArrowDown />
        </IconAction>
        <IconAction
          label={t("Delete {name}", { name: field.name })}
          size="icon-xs"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash2 />
        </IconAction>
      </div>
      {field.type === "choice" && (
        <label className="block space-y-1 text-xs text-muted-foreground">
          <span>{t("Choices, one per line")}</span>
          <Textarea
            dir="auto"
            rows={Math.min(6, Math.max(2, lines.length + 1))}
            value={choices}
            onChange={(event) => setChoices(event.target.value)}
          />
          <span className="block">
            {t("Removing a choice clears it from the vouchers that use it.")}
          </span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <span id={`${id}-count`} className="text-xs text-muted-foreground">
          {t("{count} vouchers have a value", { count: formatNumber(field.valueCount, locale) })}
        </span>
        {dirty && (
          <div className="ms-auto">
            <Button
              size="xs"
              disabled={busy || !name.trim() || (field.type === "choice" && !lines.length)}
              onClick={() =>
                void onSave({
                  id: field.id,
                  name: name.trim(),
                  type: field.type,
                  choices: lines.map((label) => {
                    const existing = field.choices.find((choice) => choice.label === label);
                    return existing ? { id: existing.id, label } : { label };
                  }),
                })
              }
            >
              {t("Save changes")}
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Sets or clears one local field on every selected voucher. */
export function BulkFieldDialog({
  open,
  count,
  fields,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  count: number;
  fields: readonly VoucherField[];
  onOpenChange: (open: boolean) => void;
  onApply: (fieldId: number, value: VoucherFieldValue | null) => Promise<string>;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [fieldId, setFieldId] = useState(fields[0]?.id ?? 0);
  const [value, setValue] = useState<VoucherFieldValue | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const field = fields.find((item) => item.id === fieldId) ?? fields[0];
  const total = formatNumber(count, locale);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("Set a field for {count} vouchers", { count: total })}</DialogTitle>
          <DialogDescription>
            {t("Leave the value empty to clear the field on the selected vouchers.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <div className="space-y-1 text-xs text-muted-foreground">
              <span>{t("Field")}</span>
              <Choice
                label={t("Field")}
                value={String(field?.id ?? "")}
                onChange={(next) => {
                  setFieldId(Number(next));
                  setValue(null);
                  setInvalid(false);
                }}
                options={fields.map((item) => ({ value: String(item.id), label: item.name }))}
              />
            </div>
            {field && (
              <label
                htmlFor={`${id}-value`}
                className="block space-y-1 text-xs text-muted-foreground"
              >
                <span>{t("Value")}</span>
                <FieldEditor
                  key={field.id}
                  id={`${id}-value`}
                  field={field}
                  value={value}
                  onChange={setValue}
                  onInvalid={setInvalid}
                />
              </label>
            )}
            <LocalOnlyNote />
            {error && (
              <Notice tone="error" icon={<CircleAlert />} announce>
                {t(error)}
              </Notice>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={busy || !field || invalid}
            onClick={() => {
              if (!field) return;
              setBusy(true);
              setError("");
              void onApply(field.id, value).then((failure) => {
                setBusy(false);
                if (failure) setError(failure);
                else onOpenChange(false);
              });
            }}
          >
            {busy ? <Spinner aria-hidden="true" role="presentation" /> : null}
            {value === null
              ? t("Clear for {count} vouchers", { count: total })
              : t("Save for {count} vouchers", { count: total })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

type FilterMode =
  | "filled"
  | "empty"
  | "contains"
  | "range"
  | "dates"
  | "yes"
  | "no"
  | `choice:${number}`;

/** Filters the list by one local field, with conditions that fit the field's type. */
export function FieldFilterDialog({
  field,
  onClose,
  onApply,
}: {
  field: VoucherField;
  onClose: () => void;
  onApply: (filter: VoucherFieldFilter) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const modes: { value: FilterMode; label: string }[] = [
    ...(field.type === "text" ? [{ value: "contains" as const, label: t("Contains") }] : []),
    ...(field.type === "number" ? [{ value: "range" as const, label: t("Between") }] : []),
    ...(field.type === "date" ? [{ value: "dates" as const, label: t("Between dates") }] : []),
    ...(field.type === "boolean"
      ? [
          { value: "yes" as const, label: t("Yes") },
          { value: "no" as const, label: t("No") },
        ]
      : []),
    ...field.choices.map((choice) => ({
      value: `choice:${choice.id}` as const,
      label: choice.label,
    })),
    { value: "filled", label: t("Has a value") },
    { value: "empty", label: t("Is empty") },
  ];
  const [mode, setMode] = useState<FilterMode>(modes[0]!.value);
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const number = (text: string) =>
    text.trim() && Number.isFinite(Number(text)) ? Number(text) : null;
  const filter = ((): VoucherFieldFilter | null => {
    const fieldId = field.id;
    if (mode === "filled" || mode === "empty") return { fieldId, op: mode };
    if (mode === "contains")
      return first.trim() ? { fieldId, op: "contains", text: first.trim() } : null;
    if (mode === "range") {
      const [min, max] = [number(first), number(second)];
      return min === null && max === null ? null : { fieldId, op: "range", min, max };
    }
    if (mode === "dates")
      return first || second
        ? { fieldId, op: "dates", from: first || null, to: second || null }
        : null;
    if (mode === "yes" || mode === "no") return { fieldId, op: "flag", value: mode === "yes" };
    return { fieldId, op: "choice", choiceId: Number(mode.slice("choice:".length)) };
  })();
  const inputType = mode === "dates" ? "date" : mode === "range" ? "number" : "text";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("Filter by {name}", { name: field.name })}</DialogTitle>
          <DialogDescription>
            {t("Show only vouchers whose local value matches.")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-3">
            <div className="space-y-1 text-xs text-muted-foreground">
              <span>{t("Show vouchers where the value")}</span>
              <Choice
                label={t("Condition")}
                value={mode}
                onChange={(next) => setMode(next as FilterMode)}
                options={modes}
              />
            </div>
            {(mode === "contains" || mode === "range" || mode === "dates") && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label htmlFor={`${id}-first`} className="space-y-1 text-xs text-muted-foreground">
                  <span>
                    {t(mode === "contains" ? "Text" : mode === "range" ? "From" : "From date")}
                  </span>
                  <Input
                    id={`${id}-first`}
                    type={inputType}
                    dir={mode === "contains" ? "auto" : "ltr"}
                    value={first}
                    onChange={(event) => setFirst(event.target.value)}
                  />
                </label>
                {mode !== "contains" && (
                  <label
                    htmlFor={`${id}-second`}
                    className="space-y-1 text-xs text-muted-foreground"
                  >
                    <span>{t(mode === "range" ? "To" : "To date")}</span>
                    <Input
                      id={`${id}-second`}
                      type={inputType}
                      dir="ltr"
                      value={second}
                      onChange={(event) => setSecond(event.target.value)}
                    />
                  </label>
                )}
              </div>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            disabled={!filter}
            onClick={() => {
              if (filter) onApply(filter);
            }}
          >
            {t("Apply filter")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** A short sentence for the active filter, shown above the table. */
export function describeFilter(
  filter: VoucherFieldFilter,
  field: VoucherField,
  locale: Locale,
  t: Translate,
): string {
  const name = field.name;
  switch (filter.op) {
    case "empty":
      return t("{name} is empty", { name });
    case "filled":
      return t("{name} has a value", { name });
    case "contains":
      return t("{name} contains “{text}”", { name, text: filter.text });
    case "range":
      return t("{name} from {min} to {max}", {
        name,
        min: filter.min === null ? "…" : formatFieldValue(field, filter.min, locale, t),
        max: filter.max === null ? "…" : formatFieldValue(field, filter.max, locale, t),
      });
    case "dates":
      return t("{name} from {min} to {max}", {
        name,
        min: filter.from === null ? "…" : formatFieldValue(field, filter.from, locale, t),
        max: filter.to === null ? "…" : formatFieldValue(field, filter.to, locale, t),
      });
    case "flag":
      return t("{name}: {value}", { name, value: t(filter.value ? "Yes" : "No") });
    case "choice":
      return t("{name}: {value}", {
        name,
        value: formatFieldValue(field, filter.choiceId, locale, t),
      });
  }
}
