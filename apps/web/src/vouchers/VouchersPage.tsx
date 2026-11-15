import { useEffect, useState } from "react";
import type {
  RouterProfile,
  Voucher,
  VoucherCatalog,
  VoucherQuery,
  VoucherPage,
  VoucherMutation,
  VoucherAction,
  VoucherOperation,
} from "@madar/contracts";
import { Plus, RefreshCw, Download, Ticket } from "lucide-react";
import { useRouters } from "../routers/RouterConnections";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Checkbox } from "../components/ui/checkbox";
import { Choice } from "../components/Choice";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { usePrivacySettings } from "../shell/settingsState";
import { SensitiveText } from "../shell/SensitiveText";
import { navigateShell } from "../shell/routes";
import { useLocale } from "../useLocale";
import { useStableCallback } from "../hooks/useStableCallback";
import { randomUUID } from "../lib/utils";
import { voucherClient, voucherError, downloadCsv } from "./client";
import { VoucherCreateForm, VoucherInspector } from "./VoucherForms";
import { formatVoucherValue } from "./format";

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
      <section className="space-y-4 p-(--workspace-page-padding)">
        <Ticket />
        <h1 className="text-3xl font-semibold">{t("Vouchers")}</h1>
        <p>{t("Add a RouterOS 6 API connection to start managing vouchers.")}</p>
        <Button onClick={() => navigateShell("/routers")}>{t("Manage connections")}</Button>
      </section>
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
    <section className="space-y-5 p-(--workspace-page-padding)">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">{t("Vouchers")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("Browse locally. Refresh from your router when connected.")}
          </p>
        </div>
        <Button variant="outline" onClick={() => navigateShell("/routers")}>
          {t(connected ? "Connection settings" : "Connect to router")}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48">
          <p className="mb-1 text-sm">{t("Customer")}</p>
          <Choice
            label={t("Customer")}
            value={selected}
            onChange={setCustomer}
            disabled={loading}
            options={catalog.customers.map((name) => ({ value: name, label: name }))}
          />
        </div>
        <Button variant="ghost" disabled={!connected || loading} onClick={() => void discover()}>
          {t(loading ? "Loading…" : "Refresh customers and profiles")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      {!connected && (
        <p className="rounded-lg border p-3 text-sm">
          {t(
            "Offline view. Cached information may be out of date; router actions require a connection.",
          )}
        </p>
      )}
      {selected ? (
        <CustomerVouchers
          key={selected}
          router={router}
          customer={selected}
          catalog={catalog}
          connected={connected}
          onCatalog={setCatalog}
        />
      ) : (
        <p className="rounded-xl border p-6">
          {t(loading ? "Loading customers…" : "Connect and refresh customers to begin.")}
        </p>
      )}
    </section>
  );
}

function CustomerVouchers({
  router,
  customer,
  catalog,
  connected,
  onCatalog,
}: {
  router: RouterProfile;
  customer: string;
  catalog: VoucherCatalog;
  connected: boolean;
  onCatalog: (value: VoucherCatalog) => void;
}) {
  const { t, locale } = useLocale();
  const { maskSensitive } = usePrivacySettings();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<VoucherQuery["status"]>("all");
  const [profile, setProfile] = useState("");
  const [sort, setSort] = useState<VoucherQuery["sort"]>("username");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [inspected, setInspected] = useState<Voucher | null>(null);
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
  const query: VoucherQuery = {
    ...scope,
    search,
    status,
    profile,
    sort,
    descending: false,
    offset,
    limit: 50,
  };
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
        setInspected(null);
        pageCache.clear();
        setRevision((value) => value + 1);
      },
      () =>
        setError(
          "The response was interrupted. Retry this same request to check its recorded outcome. Do not submit the action again with a new request.",
        ),
    );
    setBusy(false);
  }
  const actions = [
    ["enable", "Enable"],
    ["disable", "Disable"],
    ["remove", "Delete"],
    ["reset-counters", "Reset counters"],
  ] as const;
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!connected || busy || syncing} onClick={() => setCreating(!creating)}>
          <Plus />
          {t("Create vouchers")}
        </Button>
        <Button
          variant="outline"
          disabled={!connected || syncing || busy}
          onClick={() => void refresh()}
        >
          <RefreshCw />
          {t(syncing ? "Refreshing…" : "Refresh vouchers")}
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
      <div className="grid gap-3 sm:grid-cols-[minmax(180px,1fr)_180px_180px_160px]">
        <Input
          aria-label={t("Search vouchers")}
          placeholder={t("Search username or comment…")}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setOffset(0);
          }}
        />
        <Choice
          label={t("Voucher status")}
          value={status}
          onChange={(value) => {
            setStatus(value as VoucherQuery["status"]);
            setOffset(0);
          }}
          options={[
            ["all", "All states"],
            ["enabled", "Enabled"],
            ["disabled", "Disabled"],
            ["online", "Online at last check"],
            ["unassigned", "No profile"],
          ].map(([value, label]) => ({ value: value!, label: t(label!) }))}
        />
        <Choice
          label={t("Filter profile")}
          value={profile}
          onChange={(value) => {
            setProfile(value);
            setOffset(0);
          }}
          options={[
            { value: "", label: t("All profiles") },
            ...catalog.profiles
              .filter((item) => !item.owner || item.owner === customer)
              .map((item) => ({ value: item.name, label: item.name })),
          ]}
        />
        <Choice
          label={t("Sort vouchers")}
          value={sort}
          onChange={(value) => {
            setSort(value === "profile" ? "profile" : "username");
            setOffset(0);
          }}
          options={[
            { value: "username", label: t("Sort by username") },
            { value: "profile", label: t("Sort by profile") },
          ]}
        />
      </div>
      {selection.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
          <span className="me-2 text-sm">{t("{count} selected", { count: selection.length })}</span>
          {actions.map(([kind, label]) => (
            <Button
              key={kind}
              variant={kind === "remove" ? "destructive" : "outline"}
              size="sm"
              disabled={!connected || busy || syncing}
              onClick={() => review({ kind, ids: selection, profile: "" })}
            >
              {t(label)}
            </Button>
          ))}
          <div className="min-w-44">
            <Choice
              label={t("Add and activate profile")}
              value=""
              disabled={!connected || busy || syncing}
              onChange={(value) => {
                if (value) review({ kind: "assign-profile", ids: selection, profile: value });
              }}
              options={[
                { value: "", label: t("Add and activate profile") },
                ...catalog.profiles
                  .filter((item) => !item.owner || item.owner === customer)
                  .map((item) => ({ value: item.name, label: item.name })),
              ]}
            />
          </div>
          <Button variant="ghost" size="sm" onClick={() => setSelection([])}>
            {t("Clear selection")}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <VoucherRows
        key={`${JSON.stringify(query)}:${revision}`}
        query={query}
        selected={selection}
        onSelection={setSelection}
        onInspect={setInspected}
        onOffset={setOffset}
      />
      {inspected && (
        <VoucherInspector
          key={`${inspected.id}:${connected}`}
          row={inspected}
          scope={scope}
          connected={connected && !busy && !syncing}
          onReview={review}
          onClose={() => setInspected(null)}
        />
      )}
      {operation && <OperationResult operation={operation} />}
      {credentials.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
          <p className="flex-1 text-sm">
            {t("Credentials for {count} confirmed vouchers are ready to export.", {
              count: credentials.length,
            })}
          </p>
          <Button
            variant="outline"
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
          <Button variant="ghost" onClick={() => setCredentials([])}>
            {t("Dismiss")}
          </Button>
        </div>
      )}
      {history.length > 0 && (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer font-medium">{t("Recent operations")}</summary>
          <div className="mt-3 space-y-3">
            {history.map((item) => (
              <div key={item.requestId}>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.createdAt).toLocaleString(locale)}
                </p>
                <OperationResult operation={item} />
              </div>
            ))}
          </div>
        </details>
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
            {pending && (
              <>
                <p>
                  {t("Action")}: {t(pending.action.kind)} · {customer}
                </p>
                <p>
                  {t("Vouchers")}:{" "}
                  {pending.action.kind === "create"
                    ? pending.action.items.length
                    : pending.action.kind === "edit"
                      ? 1
                      : pending.action.ids.length}
                </p>
                {pending.action.kind === "create" && (
                  <div className="max-h-24 overflow-auto text-sm">
                    <SensitiveText
                      value={pending.action.items.map((item) => item.username).join(", ")}
                      label={t("Username")}
                      masked={maskSensitive}
                    />
                  </div>
                )}
                {pending.action.kind === "remove" && (
                  <p>{t("Deleting vouchers cannot be undone.")}</p>
                )}
                {pending.action.kind === "reset-counters" && (
                  <p>
                    {t(
                      "This resets usage counters. It does not renew a profile or guarantee an active session disconnects.",
                    )}
                  </p>
                )}
                {pending.action.kind === "disable" && (
                  <p>
                    {t("Disabling a voucher may not immediately disconnect its active sessions.")}
                  </p>
                )}
                {(pending.action.kind === "create" || pending.action.kind === "assign-profile") && (
                  <p>
                    {t("Profile")}: <bdi>{pending.action.profile || t("No profile")}</bdi>
                  </p>
                )}
                {pending.action.kind === "edit" && (
                  <div className="space-y-2 text-sm">
                    <SensitiveText
                      value={pending.action.username}
                      label={t("Username")}
                      masked={maskSensitive}
                    />
                    <p>
                      {t("Shared users")}: {pending.action.sharedUsers}
                    </p>
                    <p>
                      {t("Comment")}: <bdi>{pending.action.comment || "–"}</bdi>
                    </p>
                    <p>
                      {t(
                        pending.action.password === undefined
                          ? "Password stays unchanged"
                          : "Password will be replaced",
                      )}
                    </p>
                  </div>
                )}
                {pending.action.kind === "assign-profile" && (
                  <p>
                    {t(
                      "Profile activation adds a new assignment. Existing sessions may continue until the network applies the change.",
                    )}
                  </p>
                )}
              </>
            )}
            {error && <p role="alert">{t(error)}</p>}
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
            <Button disabled={busy || !connected} onClick={() => void execute()}>
              {t(busy ? "Applying…" : error ? "Check recorded outcome" : "Confirm")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}

function VoucherRows({
  query,
  selected,
  onSelection,
  onInspect,
  onOffset,
}: {
  query: VoucherQuery;
  selected: string[];
  onSelection: (value: string[]) => void;
  onInspect: (voucher: Voucher) => void;
  onOffset: (offset: number) => void;
}) {
  const { t, locale } = useLocale();
  const { maskSensitive } = usePrivacySettings();
  const key = JSON.stringify(query);
  const [page, setPage] = useState<VoucherPage | null>(() => pageCache.get(key) ?? null);
  const [error, setError] = useState("");
  useEffect(() => {
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
  }, [query, key]);
  if (error) return <p role="alert">{t(error)}</p>;
  if (!page) return <p role="status">{t("Loading saved vouchers…")}</p>;
  const all = page.items.length > 0 && page.items.every((row) => selected.includes(row.id));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <p role="status">
          {t("{count} vouchers", { count: page.total })} ·{" "}
          {page.syncedAt
            ? t("Last full refresh: {time}", {
                time: new Date(page.syncedAt).toLocaleString(locale),
              })
            : t("Initial download not completed")}
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={!page.items.length || maskSensitive}
          onClick={() =>
            downloadCsv("قسائم-مدار.csv", [
              [
                t("Username"),
                t("Customer"),
                t("Profile"),
                t("State"),
                t("Upload"),
                t("Download"),
                t("Uptime"),
                t("Last seen"),
              ],
              ...page.items.map((row) => [
                row.username,
                row.customer,
                row.profile,
                t(row.disabled ? "Disabled" : "Enabled"),
                row.upload,
                row.download,
                row.uptime,
                row.lastSeen,
              ]),
            ])
          }
        >
          <Download />
          {t("Export this page")}
        </Button>
      </div>
      {!page.complete && (
        <p className="text-sm text-muted-foreground">
          {t(
            "Refresh vouchers to download this customer's full list. Search results are incomplete until then.",
          )}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-start text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="w-10 p-3">
                <Checkbox
                  aria-label={t("Select this page")}
                  checked={all}
                  onCheckedChange={(checked) =>
                    onSelection(
                      checked
                        ? [...new Set([...selected, ...page.items.map((row) => row.id)])].slice(
                            0,
                            100,
                          )
                        : selected.filter((id) => !page.items.some((row) => row.id === id)),
                    )
                  }
                />
              </th>
              {["Username", "State", "Profile", "Download", "Upload", "Uptime", "Last seen"].map(
                (label) => (
                  <th key={label} className="whitespace-nowrap p-3 text-start font-medium">
                    {t(label)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {page.items.map((row) => (
              <tr key={row.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="p-3">
                  <Checkbox
                    aria-label={t("Select voucher {name}", {
                      name: maskSensitive ? "••••" : row.username,
                    })}
                    checked={selected.includes(row.id)}
                    disabled={selected.length >= 100 && !selected.includes(row.id)}
                    onCheckedChange={(checked) =>
                      onSelection(
                        checked ? [...selected, row.id] : selected.filter((id) => id !== row.id),
                      )
                    }
                  />
                </td>
                <td className="p-3">
                  <Button variant="link" size="sm" onClick={() => onInspect(row)}>
                    {maskSensitive ? "••••••••" : row.username}
                  </Button>
                </td>
                <td className="whitespace-nowrap p-3">
                  {t(
                    row.disabled
                      ? "Disabled"
                      : Number(row.activeSessions) > 0
                        ? "Online"
                        : "Enabled",
                  )}
                </td>
                <td className="p-3">{row.profile || t("No profile")}</td>
                {(["download", "upload", "uptime", "lastSeen"] as const).map((field) => (
                  <td key={field} className="whitespace-nowrap p-3 tabular-nums">
                    {formatVoucherValue(row[field], field, locale)}
                  </td>
                ))}
              </tr>
            ))}
            {page.items.length === 0 && (
              <tr>
                <td colSpan={8} className="p-8 text-center text-muted-foreground">
                  {t(
                    page.complete
                      ? "No vouchers match these filters."
                      : "No vouchers downloaded yet.",
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {t("Showing {start}–{end} of {total}", {
            start: page.total ? query.offset + 1 : 0,
            end: Math.min(query.offset + query.limit, page.total),
            total: page.total,
          })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={query.offset === 0}
            onClick={() => onOffset(Math.max(0, query.offset - query.limit))}
          >
            {t("Previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={query.offset + query.limit >= page.total}
            onClick={() => onOffset(query.offset + query.limit)}
          >
            {t("Next")}
          </Button>
        </div>
      </div>
    </div>
  );
}
function OperationResult({ operation }: { operation: VoucherOperation }) {
  const { t } = useLocale();
  const { maskSensitive } = usePrivacySettings();
  return (
    <div className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">
        {t(
          operation.state === "completed"
            ? "Operation confirmed"
            : operation.state === "running"
              ? "Interrupted operation – check router state before trying again"
              : "Operation needs attention",
        )}
        : {t(operation.kind)}
      </p>
      {operation.outcomes.map((outcome) => (
        <p key={outcome.target}>
          {maskSensitive ? "••••••••" : outcome.target} · {t(outcome.state)}
          {outcome.reason ? ` · ${t(outcome.reason)}` : ""}
        </p>
      ))}
      {operation.state !== "completed" && (
        <p className="text-muted-foreground">
          {t(
            "Refresh the affected vouchers before deciding what to do next. Uncertain operations are never replayed automatically.",
          )}
        </p>
      )}
    </div>
  );
}
