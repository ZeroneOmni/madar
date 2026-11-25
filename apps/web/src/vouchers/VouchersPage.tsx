import { useEffect, useRef, useState } from "react";
import type {
  RouterDatabaseStatus,
  RouterProfile,
  VoucherField,
  VoucherFieldFilter,
  VoucherFieldValue,
  VoucherRow,
  VoucherCatalog,
  VoucherQuery,
  VoucherPage,
  VoucherMutation,
  VoucherAction,
  VoucherOperation,
} from "@madar/contracts";
import {
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CloudOff,
  Database,
  Download,
  Info,
  KeyRound,
  Plus,
  RefreshCw,
  SearchIcon,
  SearchX,
  Ticket,
  TriangleAlert,
} from "lucide-react";
import { useRouters } from "../routers/RouterConnections";
import { Button } from "../components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "../components/ui/empty";
import { Choice } from "../components/Choice";
import {
  Detail,
  Disclosure,
  IconAction,
  Notice,
  PageFrame,
  PageHeader,
  Panel,
} from "../components/WorkspacePage";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { CopyableText } from "../shell/CopyableText";
import { navigateShell } from "../shell/routes";
import { useLocale } from "../useLocale";
import { useStableCallback } from "../hooks/useStableCallback";
import { randomUUID } from "../lib/utils";
import { voucherClient, voucherError, downloadCsv, VoucherRequestError } from "./client";
import { VoucherCreateForm, VoucherInspector } from "./VoucherForms";
import {
  columnOf,
  fieldIdOf,
  querySort,
  type ColumnId,
  type ColumnKey,
  type ViewSort,
} from "./columns";
import {
  BulkFieldDialog,
  describeFilter,
  FieldFilterDialog,
  formatFieldValue,
  VoucherFieldsDialog,
} from "./VoucherFields";
import { cellText } from "./VoucherCells";
import { ColumnsPopover, SortMenu } from "./VoucherLayoutControls";
import { VoucherTable } from "./VoucherTable";
import { useVoucherLayout } from "./useVoucherLayout";
import { formatDateTime, formatNumber } from "../locale";
import { formatBytes } from "./format";
import {
  actionableFailures,
  failureReasons,
  runningStages,
  stoppedStages,
  useRouterDatabase,
} from "./routerDatabase";

const pageCache = new Map<string, VoucherPage>();
function cachePage(key: string, page: VoucherPage) {
  pageCache.delete(key);
  pageCache.set(key, page);
  if (pageCache.size > 24) pageCache.delete(pageCache.keys().next().value!);
}

export function VouchersPage() {
  const { t } = useLocale();
  const model = useRouters();
  const router = model.catalog.routers.find((router) => router.id === model.catalog.selected);
  if (!router)
    return (
      <PageFrame>
        <PageHeader
          title={t("Vouchers")}
          description={t("Browse locally. Refresh from your router when connected.")}
        />
        <Panel>
          <Empty size="compact">
            <EmptyMedia variant="icon">
              <Ticket />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>{t("No router selected")}</EmptyTitle>
              <EmptyDescription>
                {t("Add a RouterOS 6 API connection to start managing vouchers.")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => navigateShell("/routers")}>{t("Manage connections")}</Button>
            </EmptyContent>
          </Empty>
        </Panel>
      </PageFrame>
    );
  return (
    <VoucherWorkspace
      key={JSON.stringify(router)}
      router={router}
      connected={model.state.kind === "connected" && model.state.service === "router-api"}
    />
  );
}
function VoucherWorkspace({ router, connected }: { router: RouterProfile; connected: boolean }) {
  const { t } = useLocale();
  const [catalog, setCatalog] = useState<VoucherCatalog>({
    customers: [],
    profiles: [],
    syncedAt: null,
  });
  const [customer, setCustomer] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<readonly VoucherField[] | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void voucherClient
      .fields(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setFields(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFields([]);
      });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void voucherClient
      .catalog(router, false, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setCatalog(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(voucherError(error));
      });
    return () => abort.abort();
  }, [router]);
  const discover = useStableCallback(async () => {
    setLoading(true);
    setError("");
    await voucherClient
      .catalog(router, true)
      .then(setCatalog, (error) => setError(voucherError(error)));
    setLoading(false);
  });
  useEffect(() => {
    if (connected) void discover();
  }, [connected, discover]);
  const selected = customer || catalog.customers[0] || "";
  return (
    <PageFrame wide>
      <PageHeader
        title={t("Vouchers")}
        description={t("Browse locally. Refresh from your router when connected.")}
      >
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-sm text-muted-foreground">{t("Customer")}</span>
          <div className="w-48">
            <Choice
              size="sm"
              label={t("Customer")}
              value={selected}
              onChange={setCustomer}
              disabled={loading || catalog.customers.length === 0}
              options={catalog.customers.map((name) => ({ value: name, label: name }))}
            />
          </div>
          <IconAction
            label={t("Refresh customers and profiles")}
            disabled={!connected || loading}
            onClick={() => void discover()}
          >
            {loading ? <Spinner aria-hidden="true" role="presentation" /> : <RefreshCw />}
          </IconAction>
        </div>
      </PageHeader>
      {!connected && (
        <Notice
          tone="warning"
          icon={<CloudOff />}
          action={
            <Button variant="outline" size="sm" onClick={() => navigateShell("/routers")}>
              {t("Connect to router")}
            </Button>
          }
        >
          {t(
            "Offline view. Cached information may be out of date; router actions require a connection.",
          )}
        </Notice>
      )}
      {error && (
        <Notice tone="error" icon={<CircleAlert />} announce>
          {t(error)}
        </Notice>
      )}
      {selected ? (
        <CustomerVouchers
          key={selected}
          router={router}
          customer={selected}
          catalog={catalog}
          connected={connected}
          onCatalog={setCatalog}
          fields={fields}
          onFields={setFields}
        />
      ) : (
        <Panel>
          <Empty size="compact">
            <EmptyMedia variant="icon">
              {loading ? <Spinner aria-hidden="true" role="presentation" /> : <Ticket />}
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle role="status">
                {t(loading ? "Loading customers…" : "Connect and refresh customers to begin.")}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
        </Panel>
      )}
    </PageFrame>
  );
}

const statusOptions = [
  ["all", "All states"],
  ["enabled", "Enabled"],
  ["disabled", "Disabled"],
  ["online", "Online at last check"],
  ["unassigned", "No profile"],
  ["low", "Nearly used up or expiring"],
  ["ended", "Used up or expired"],
  ["unknown", "Remaining unknown"],
] as const;

function CustomerVouchers({
  router,
  customer,
  catalog,
  connected,
  onCatalog,
  fields: loadedFields,
  onFields,
}: {
  router: RouterProfile;
  customer: string;
  catalog: VoucherCatalog;
  connected: boolean;
  onCatalog: (value: VoucherCatalog) => void;
  fields: readonly VoucherField[] | null;
  onFields: (fields: readonly VoucherField[]) => void;
}) {
  const { t, locale, direction } = useLocale();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VoucherQuery["status"]>("all");
  const [profile, setProfile] = useState("");
  const fields = loadedFields ?? [];
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const layout = useVoucherLayout(
    loadedFields ? new Set(loadedFields.map((field) => field.id)) : null,
  );
  const [savedFilter, setFieldFilter] = useState<VoucherFieldFilter | null>(null);
  // A filter on a deleted field no longer applies.
  const filteredField = savedFilter ? fieldById.get(savedFilter.fieldId) : undefined;
  const fieldFilter =
    savedFilter &&
    filteredField &&
    (savedFilter.op !== "choice" ||
      filteredField.choices.some((choice) => choice.id === savedFilter.choiceId))
      ? savedFilter
      : null;
  const [fieldsDialog, setFieldsDialog] = useState<{ adding: boolean } | null>(null);
  const [filtering, setFiltering] = useState<VoucherField | null>(null);
  const [bulkField, setBulkField] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [inspected, setInspected] = useState<VoucherRow | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<VoucherMutation | null>(null);
  const [operation, setOperation] = useState<VoucherOperation | null>(null);
  const [history, setHistory] = useState<readonly VoucherOperation[]>([]);
  const [credentials, setCredentials] = useState<readonly { username: string; password: string }[]>(
    [],
  );
  const scope = { router, customer };
  // A manual copy reports its outcome here; automatic ones stay quiet and show in Connections.
  const watching = useRef(false);
  const [finished, setFinished] = useState<RouterDatabaseStatus | null>(null);
  const database = useRouterDatabase(scope, (status) => {
    if (status.outcome === "accepted") {
      pageCache.clear();
      setRevision((value) => value + 1);
    }
    if (watching.current) {
      watching.current = false;
      setFinished(status);
    }
  });
  const job = database.status?.job ?? null;
  const update = () => {
    setFinished(null);
    watching.current = true;
    void database.start();
  };
  const query: VoucherQuery = {
    router,
    customer,
    search,
    status,
    profile,
    sort: querySort(layout.sort),
    ...(fieldFilter ? { fieldFilter } : {}),
    offset,
    limit: 50,
  };
  const reload = () => {
    // A field edit can move vouchers out of an active field filter; start again from page one.
    if (fieldFilter) setOffset(0);
    pageCache.clear();
    setRevision((value) => value + 1);
  };
  async function applyBulkField(fieldId: number, value: VoucherFieldValue | null) {
    return voucherClient
      .setFieldValues({ ...scope, ids: selection, values: [{ fieldId, value }] })
      .then(
        (result) => {
          reload();
          void voucherClient.fields().then(onFields, () => {});
          return result.updated < selection.length
            ? t(
                "Saved for {updated} of {count} vouchers. The others are no longer saved on this PC.",
                {
                  updated: formatNumber(result.updated, locale),
                  count: formatNumber(selection.length, locale),
                },
              )
            : "";
        },
        (cause) => voucherError(cause),
      );
  }
  const profiles = catalog.profiles.filter((item) => !item.owner || item.owner === customer);
  const refresh = useStableCallback(async () => {
    if (syncing || busy || pending) return true;
    let successful = true;
    setSyncing(true);
    setError("");
    await voucherClient.sync(scope).then(
      (value) => {
        onCatalog(value);
        pageCache.clear();
        setRevision((value) => value + 1);
        // A refresh may start or schedule a router database copy.
        database.check();
      },
      (error) => {
        successful = false;
        setError(voucherError(error));
      },
    );
    setSyncing(false);
    return successful;
  });
  useEffect(() => {
    if (!connected) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    async function poll() {
      const started = performance.now();
      if (document.visibilityState === "visible") {
        failures = (await refresh()) ? 0 : failures + 1;
      }
      if (stopped) return;
      const delay = Math.min(
        1800000,
        Math.max(300000 * 2 ** Math.min(failures, 3), (performance.now() - started) * 20),
      );
      timer = setTimeout(() => void poll(), delay);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [connected, refresh]);
  useEffect(() => {
    void voucherClient
      .history({ router, customer })
      .then(setHistory)
      .catch(() => {});
  }, [router, customer]);
  function review(action: VoucherAction) {
    setPending({ ...scope, requestId: randomUUID(), action });
    setError("");
  }
  async function execute() {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    await voucherClient.mutate(pending).then(
      (result) => {
        setOperation(result);
        void voucherClient
          .history(scope)
          .then(setHistory)
          .catch(() => {});
        const action = pending.action;
        if (action.kind === "create") {
          const confirmed = new Set(
            result.outcomes
              .filter((outcome) => outcome.state === "confirmed")
              .map((outcome) => outcome.target),
          );
          setCredentials(action.items.filter((item) => confirmed.has(item.username)));
        }
        setPending(null);
        setCreating(false);
        setSelection([]);
        setInspectorOpen(false);
        setInspected(null);
        pageCache.clear();
        setRevision((value) => value + 1);
      },
      (error) =>
        setError(
          error instanceof VoucherRequestError
            ? voucherError(error)
            : "The response was interrupted. Retry this same request to check its recorded outcome. Do not submit the action again with a new request.",
        ),
    );
    setBusy(false);
  }
  const locked = !connected || busy || syncing;
  const actions = [
    ["enable", "Enable"],
    ["disable", "Disable"],
    ["reset-counters", "Reset counters"],
  ] as const;
  return (
    <>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={!connected || job !== null} onClick={update}>
          <Database />
          {t("Update from router database")}
        </Button>
        <Button variant="outline" disabled={locked} onClick={() => void refresh()}>
          {syncing ? <Spinner aria-hidden="true" role="presentation" /> : <RefreshCw />}
          {t(syncing ? "Refreshing…" : "Refresh vouchers")}
        </Button>
        <Button aria-expanded={creating} disabled={locked} onClick={() => setCreating(!creating)}>
          <Plus />
          {t("Create vouchers")}
        </Button>
      </div>
      {creating && (
        <VoucherCreateForm
          catalog={catalog}
          customer={customer}
          onReview={review}
          onCancel={() => setCreating(false)}
        />
      )}
      {database.status?.job && (
        <DatabaseProgress status={database.status} onCancel={() => void database.cancel()} />
      )}
      {database.error && (
        <Notice tone="error" icon={<CircleAlert />} announce>
          {t(database.error)}
        </Notice>
      )}
      {finished && !job && (
        <DatabaseResult status={finished} onRetry={update} onDismiss={() => setFinished(null)} />
      )}
      {operation && <OperationResult operation={operation} onDismiss={() => setOperation(null)} />}
      {credentials.length > 0 && (
        <Notice
          tone="info"
          icon={<KeyRound />}
          action={
            <>
              <Button variant="ghost" size="sm" onClick={() => setCredentials([])}>
                {t("Dismiss")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadCsv("قسائم-مدار-بيانات-الدخول.csv", [
                    [t("Username"), t("Password")],
                    ...credentials.map((item) => [item.username, item.password]),
                  ])
                }
              >
                <Download />
                {t("Export credentials")}
              </Button>
            </>
          }
        >
          {t("Credentials for {count} confirmed vouchers are ready to export.", {
            count: formatNumber(credentials.length, locale),
          })}
        </Notice>
      )}
      {error && !pending && (
        <Notice tone="error" icon={<CircleAlert />} announce>
          {t(error)}
        </Notice>
      )}
      <Panel>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-56">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                size="sm"
                type="search"
                aria-label={t("Search vouchers")}
                placeholder={t("Search username or comment…")}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
              />
            </InputGroup>
          </div>
          <div className="w-40 grow sm:grow-0">
            <Choice
              size="sm"
              label={t("Voucher status")}
              value={status}
              onChange={(value) => {
                setStatus(value as VoucherQuery["status"]);
                setOffset(0);
              }}
              options={statusOptions.map(([value, label]) => ({ value, label: t(label) }))}
            />
          </div>
          <div className="w-40 grow sm:grow-0">
            <Choice
              size="sm"
              label={t("Filter profile")}
              value={profile}
              onChange={(value) => {
                setProfile(value);
                setOffset(0);
              }}
              options={[
                { value: "", label: t("All profiles") },
                ...profiles.map((item) => ({ value: item.name, label: item.name })),
              ]}
            />
          </div>
          <div className="ms-auto flex items-center gap-2">
            <SortMenu
              sort={layout.sort}
              columns={layout.columns}
              fields={fields}
              onSort={(sort) => {
                layout.setSort(sort);
                setOffset(0);
              }}
              onAnnounce={setAnnouncement}
            />
            <ColumnsPopover
              columns={layout.columns}
              fields={fields}
              onColumns={layout.setColumns}
              onAnnounce={setAnnouncement}
              onManageFields={(adding) => setFieldsDialog({ adding })}
            />
          </div>
        </div>
        {fieldFilter && (
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="text-muted-foreground">{t("Filtered by your field:")}</span>
            <bdi className="font-medium">
              {describeFilter(fieldFilter, fieldById.get(fieldFilter.fieldId)!, locale, t)}
            </bdi>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setFieldFilter(null);
                setOffset(0);
              }}
            >
              {t("Clear filter")}
            </Button>
          </div>
        )}
        <p role="status" aria-live="polite" className="sr-only">
          {announcement}
        </p>
        {selection.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 bg-primary/5 px-3 py-2">
            <p className="me-2 text-sm font-medium">
              {t("{count} selected", { count: formatNumber(selection.length, locale) })}
            </p>
            {actions.map(([kind, label]) => (
              <Button
                key={kind}
                variant="outline"
                size="sm"
                disabled={locked}
                onClick={() => review({ kind, ids: selection, profile: "" })}
              >
                {t(label)}
              </Button>
            ))}
            <div className="w-48">
              <Choice
                size="sm"
                label={t("Add and activate profile")}
                value=""
                disabled={locked}
                onChange={(value) => {
                  if (value) review({ kind: "assign-profile", ids: selection, profile: value });
                }}
                options={[
                  { value: "", label: t("Add and activate profile") },
                  ...profiles.map((item) => ({ value: item.name, label: item.name })),
                ]}
              />
            </div>
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={locked}
              onClick={() => review({ kind: "remove", ids: selection, profile: "" })}
            >
              {t("Delete")}
            </Button>
            {fields.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setBulkField(true)}>
                {t("Set a field")}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => setSelection([])}>
              {t("Clear selection")}
            </Button>
          </div>
        )}
        <VoucherRows
          key={`${JSON.stringify(query)}:${revision}`}
          query={query}
          copiedAt={database.status?.capturedAt ?? null}
          view={layout.sort}
          columns={layout.columns}
          fields={fieldById}
          onFilterField={setFiltering}
          selected={selection}
          onSelection={setSelection}
          onInspect={(voucher) => {
            setInspected(voucher);
            setInspectorOpen(true);
          }}
          onOffset={setOffset}
          onSort={(sort) => {
            layout.setSort(sort);
            setOffset(0);
          }}
          onColumns={layout.setColumns}
          onAnnounce={setAnnouncement}
        />
      </Panel>
      {history.length > 0 && (
        <Disclosure
          title={t("Recent operations")}
          meta={
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatNumber(history.length, locale)}
            </span>
          }
        >
          <Panel>
            {history.map((item) => (
              <div key={item.requestId} className="space-y-1.5 px-4 py-3">
                <time
                  dateTime={item.createdAt}
                  className="block text-xs text-muted-foreground tabular-nums"
                >
                  {formatDateTime(item.createdAt, locale)}
                </time>
                <OperationSummary operation={item} />
              </div>
            ))}
          </Panel>
        </Disclosure>
      )}
      <Sheet
        open={inspected !== null && inspectorOpen && pending === null}
        onOpenChange={(open) => {
          if (!open) setInspectorOpen(false);
        }}
        onOpenChangeComplete={(open) => {
          if (!open && !inspectorOpen) setInspected(null);
        }}
      >
        <SheetPopup
          keepMounted
          side={direction === "rtl" ? "left" : "right"}
          showCloseButton={false}
          aria-label={t("Voucher details")}
        >
          {inspected && (
            <VoucherInspector
              key={`${inspected.id}:${connected}`}
              row={inspected}
              scope={scope}
              connected={connected && !busy && !syncing}
              onReview={review}
              onClose={() => setInspectorOpen(false)}
              fields={fields}
              onFieldsSaved={() => {
                reload();
                void voucherClient.fields().then(onFields, () => {});
              }}
            />
          )}
        </SheetPopup>
      </Sheet>
      {fieldsDialog && (
        <VoucherFieldsDialog
          open
          adding={fieldsDialog.adding}
          fields={fields}
          onOpenChange={(open) => {
            if (!open) setFieldsDialog(null);
          }}
          onFields={(next) => {
            onFields(next);
            reload();
          }}
        />
      )}
      {bulkField && (
        <BulkFieldDialog
          open
          count={selection.length}
          fields={fields}
          onOpenChange={setBulkField}
          onApply={applyBulkField}
        />
      )}
      {filtering && (
        <FieldFilterDialog
          field={filtering}
          onClose={() => setFiltering(null)}
          onApply={(filter) => {
            setFieldFilter(filter);
            setFiltering(null);
            setOffset(0);
          }}
        />
      )}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy && !error) setPending(null);
        }}
      >
        <DialogPopup showCloseButton={!busy && !error}>
          <DialogHeader>
            <DialogTitle>{t("Confirm voucher operation")}</DialogTitle>
            <DialogDescription>
              {t("Review the action before changing your router.")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {pending && <PendingReview pending={pending} customer={customer} />}
            {error && (
              <Notice tone="error" icon={<CircleAlert />} announce>
                {t(error)}
              </Notice>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setError("");
              }}
            >
              {t("Cancel")}
            </Button>
            <Button
              variant={pending?.action.kind === "remove" && !error ? "destructive" : "default"}
              disabled={busy || !connected}
              onClick={() => void execute()}
            >
              {busy ? <Spinner aria-hidden="true" role="presentation" /> : null}
              {t(busy ? "Applying…" : error ? "Check recorded outcome" : "Confirm")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function PendingReview({ pending, customer }: { pending: VoucherMutation; customer: string }) {
  const { t, locale } = useLocale();
  const action = pending.action;
  const count =
    action.kind === "create" ? action.items.length : action.kind === "edit" ? 1 : action.ids.length;
  const warning =
    action.kind === "remove"
      ? "Deleting vouchers cannot be undone."
      : action.kind === "reset-counters"
        ? "This resets usage counters. It does not renew a profile or guarantee an active session disconnects."
        : action.kind === "disable"
          ? "Disabling a voucher may not immediately disconnect its active sessions."
          : action.kind === "assign-profile"
            ? "Profile activation adds a new assignment. Existing sessions may continue until the network applies the change."
            : null;
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border/60 bg-card/40 p-3">
        <Detail label={t("Action")}>{t(action.kind)}</Detail>
        <Detail label={t("Customer")}>
          <bdi>{customer}</bdi>
        </Detail>
        <Detail label={t("Vouchers")}>{formatNumber(count, locale)}</Detail>
        {(action.kind === "create" || action.kind === "assign-profile") && (
          <Detail label={t("Profile")}>
            <bdi>{action.profile || t("No profile")}</bdi>
          </Detail>
        )}
        {action.kind === "edit" && (
          <>
            <Detail label={t("Shared users")}>{formatNumber(action.sharedUsers, locale)}</Detail>
            <Detail label={t("Comment")}>
              <bdi>{action.comment || "–"}</bdi>
            </Detail>
            <Detail label={t("Password")}>
              {t(
                action.password === undefined
                  ? "Password stays unchanged"
                  : "Password will be replaced",
              )}
            </Detail>
          </>
        )}
      </dl>
      {action.kind === "create" && (
        <div className="max-h-48 overflow-auto rounded-xl border border-border/60">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-1.5 text-start font-medium">{t("Username")}</th>
                <th className="px-3 py-1.5 text-start font-medium">{t("Password")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50 font-mono">
              {action.items.map((item) => (
                <tr key={item.username}>
                  <td className="px-3 py-1.5">
                    <bdi dir="ltr">{item.username}</bdi>
                  </td>
                  <td className="px-3 py-1.5">
                    <bdi dir="ltr">{item.password || "–"}</bdi>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {action.kind === "edit" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <CopyableText value={action.username} label={t("Username")} />
          {action.password !== undefined && (
            <CopyableText value={action.password} label={t("Password")} />
          )}
        </div>
      )}
      {warning && (
        <Notice
          tone={action.kind === "remove" ? "warning" : "default"}
          icon={action.kind === "remove" ? <TriangleAlert /> : <Info />}
        >
          {t(warning)}
        </Notice>
      )}
    </div>
  );
}

function VoucherRows({
  query,
  copiedAt,
  view,
  columns,
  fields,
  onFilterField,
  selected,
  onSelection,
  onInspect,
  onOffset,
  onSort,
  onColumns,
  onAnnounce,
}: {
  query: VoucherQuery;
  copiedAt: string | null;
  view: ViewSort;
  columns: readonly ColumnId[];
  fields: ReadonlyMap<number, VoucherField>;
  onFilterField: (field: VoucherField) => void;
  selected: string[];
  onSelection: (value: string[]) => void;
  onInspect: (voucher: VoucherRow) => void;
  onOffset: (offset: number) => void;
  onSort: (sort: ViewSort) => void;
  onColumns: (columns: readonly ColumnId[]) => void;
  onAnnounce: (message: string) => void;
}) {
  const { t, locale } = useLocale();
  const key = JSON.stringify(query);
  // The parent remounts this component for every new query, so the first one is the only one.
  const [initial] = useState(query);
  const [page, setPage] = useState<VoucherPage | null>(() => pageCache.get(key) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
    const query = initial;
    const abort = new AbortController();
    void voucherClient
      .list(query, abort.signal)
      .then((value) => {
        if (abort.signal.aborted) return;
        cachePage(key, value);
        setPage(value);
        if (query.offset + query.limit < value.total) {
          const next = { ...query, offset: query.offset + query.limit };
          void voucherClient
            .list(next, abort.signal)
            .then((page) => {
              if (!abort.signal.aborted) cachePage(JSON.stringify(next), page);
            })
            .catch(() => {});
        }
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(voucherError(error));
      });
    return () => abort.abort();
  }, [initial, key]);
  if (error)
    return (
      <div className="px-4 py-6">
        <p role="alert" className="flex items-center gap-2 text-sm text-destructive">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
          {t(error)}
        </p>
      </div>
    );
  const exported = columns.filter((key) => fieldIdOf(key) === null || fields.has(fieldIdOf(key)!));
  if (!page)
    return (
      <div aria-busy="true" className="space-y-3 px-4 py-4">
        <p role="status" className="sr-only">
          {t("Loading saved vouchers…")}
        </p>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Skeleton key={row} className="h-6 w-full" />
        ))}
      </div>
    );
  return (
    <>
      {!page.complete && (
        <p className="flex items-start gap-2 bg-info/4 px-4 py-2.5 text-xs text-muted-foreground">
          <Info aria-hidden="true" className="mt-px size-3.5 shrink-0 text-info" />
          {t(
            "Refresh vouchers to download this customer's full list. Search results are incomplete until then.",
          )}
        </p>
      )}
      {page.items.length === 0 ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">{page.complete ? <SearchX /> : <Ticket />}</EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              {t(
                page.complete ? "No vouchers match these filters." : "No vouchers downloaded yet.",
              )}
            </EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <VoucherTable
          rows={page.items}
          columns={columns}
          sort={view}
          fields={fields}
          onFilterField={onFilterField}
          selected={selected}
          onSelection={onSelection}
          onInspect={onInspect}
          onSort={onSort}
          onColumns={onColumns}
          onAnnounce={onAnnounce}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-xs text-muted-foreground">
        <p role="status" className="tabular-nums">
          {t("Showing {start}–{end} of {total}", {
            start: formatNumber(page.total ? query.offset + 1 : 0, locale),
            end: formatNumber(Math.min(query.offset + query.limit, page.total), locale),
            total: formatNumber(page.total, locale),
          })}
        </p>
        <p>
          {page.syncedAt
            ? t("Last full refresh: {time}", {
                time: formatDateTime(page.syncedAt, locale),
              })
            : t("Initial download not completed")}
        </p>
        {copiedAt && (
          <p className="inline-flex items-center gap-1.5">
            <Database aria-hidden="true" className="size-3.5 shrink-0" />
            {t("Router database copied {time}", { time: formatDateTime(copiedAt, locale) })}
          </p>
        )}
        <div className="ms-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="xs"
            disabled={!page.items.length}
            onClick={() =>
              downloadCsv("قسائم-مدار.csv", [
                [
                  t("Customer"),
                  ...exported.map(
                    (key) =>
                      fields.get(fieldIdOf(key) ?? 0)?.name ?? t(columnOf(key as ColumnKey).label),
                  ),
                  t("Comment"),
                ],
                ...page.items.map((row) => [
                  row.customer,
                  ...exported.map((key) => {
                    const field = fields.get(fieldIdOf(key) ?? 0);
                    return field
                      ? formatFieldValue(field, row.fields[String(field.id)], locale, t)
                      : cellText(key as ColumnKey, row, locale, t);
                  }),
                  row.comment,
                ]),
              ])
            }
          >
            <Download />
            {t("Export this page")}
          </Button>
          <IconAction
            label={t("Previous")}
            disabled={query.offset === 0}
            onClick={() => onOffset(Math.max(0, query.offset - query.limit))}
          >
            <ChevronLeft className="rtl:rotate-180" />
          </IconAction>
          <IconAction
            label={t("Next")}
            disabled={query.offset + query.limit >= page.total}
            onClick={() => onOffset(query.offset + query.limit)}
          >
            <ChevronRight className="rtl:rotate-180" />
          </IconAction>
        </div>
      </div>
    </>
  );
}

function OperationSummary({ operation }: { operation: VoucherOperation }) {
  const { t } = useLocale();
  return (
    <div className="space-y-1.5 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 font-medium">
        {operation.state === "completed" ? (
          <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
        ) : (
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0 text-warning" />
        )}
        <span>
          {t(
            operation.state === "completed"
              ? "Operation confirmed"
              : operation.state === "running"
                ? "Interrupted operation – check router state before trying again"
                : "Operation needs attention",
          )}
        </span>
        <span className="font-normal text-muted-foreground">{t(operation.kind)}</span>
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-auto ps-6 text-xs">
        {operation.outcomes.map((outcome) => (
          <li key={outcome.target} className="flex flex-wrap gap-x-2">
            <bdi dir="ltr" className="font-mono text-foreground">
              {outcome.target}
            </bdi>
            <span className="text-muted-foreground">{t(outcome.state)}</span>
            {outcome.reason ? (
              <span className="text-muted-foreground">{t(outcome.reason)}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {operation.state !== "completed" && (
        <p className="text-xs text-muted-foreground">
          {t(
            "Refresh the affected vouchers before deciding what to do next. Uncertain operations are never replayed automatically.",
          )}
        </p>
      )}
    </div>
  );
}

function OperationResult({
  operation,
  onDismiss,
}: {
  operation: VoucherOperation;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  return (
    <Notice
      tone={operation.state === "completed" ? "success" : "warning"}
      action={
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          {t("Dismiss")}
        </Button>
      }
    >
      <OperationSummary operation={operation} />
    </Notice>
  );
}

/** A copy in progress. The list stays usable; only the numbers update when it finishes. */
function DatabaseProgress({
  status,
  onCancel,
}: {
  status: RouterDatabaseStatus;
  onCancel: () => void;
}) {
  const { t, locale } = useLocale();
  const job = status.job!;
  const ratio = job.stage === "download" && job.total ? job.received / job.total : null;
  return (
    <Notice
      tone="info"
      icon={<Database />}
      action={
        <Button variant="outline" size="sm" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      }
    >
      <div className="space-y-2">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span role="status">{t(runningStages[job.stage])}</span>
          {ratio !== null && (
            <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
              {t("{amount} of {limit}", {
                amount: formatBytes(job.received, locale),
                limit: formatBytes(job.total, locale),
              })}
            </span>
          )}
        </p>
        {ratio !== null && (
          <div
            role="progressbar"
            aria-label={t("Copying the router database…")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratio * 100)}
            className="h-1 w-full max-w-sm rounded-full bg-info/15"
          >
            <div
              className="h-full rounded-full bg-info"
              style={{ inlineSize: `${Math.max(2, Math.round(ratio * 100))}%` }}
            />
          </div>
        )}
        {job.trigger !== "manual" && (
          <p className="text-xs text-muted-foreground">
            {t(
              "Madar reads each package's usage from the router's User Manager database. You can keep working.",
            )}
          </p>
        )}
      </div>
    </Notice>
  );
}

function DatabaseResult({
  status,
  onRetry,
  onDismiss,
}: {
  status: RouterDatabaseStatus;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocale();
  const dismiss = (
    <Button variant="ghost" size="sm" onClick={onDismiss}>
      {t("Dismiss")}
    </Button>
  );
  if (status.outcome === "accepted" || status.outcome === "unchanged")
    return (
      <Notice tone="success" icon={<CircleCheck />} action={dismiss}>
        {t("Package usage updated from the router database.")}
      </Notice>
    );
  if (status.outcome === "cancelled")
    return (
      <Notice icon={<Info />} action={dismiss}>
        {t("Copy cancelled. Madar kept the values it had.")}
      </Notice>
    );
  const failure = status.failure;
  if (!failure) return null;
  return (
    <Notice
      tone="warning"
      icon={<TriangleAlert />}
      announce
      action={
        <>
          {dismiss}
          {actionableFailures.has(failure.reason) ? (
            <Button variant="outline" size="sm" onClick={() => navigateShell("/routers")}>
              {t("Open Connections")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("Try again")}
            </Button>
          )}
        </>
      }
    >
      <span className="block">{t(failureReasons[failure.reason])}</span>
      <span className="block text-xs text-muted-foreground">{t(stoppedStages[failure.stage])}</span>
    </Notice>
  );
}
