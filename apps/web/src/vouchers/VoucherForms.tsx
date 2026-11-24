import { useEffect, useId, useState } from "react";
import type {
  Voucher,
  VoucherField,
  VoucherRow,
  VoucherAction,
  VoucherCatalog,
  VoucherDetails,
  VoucherScope,
} from "@madar/contracts";
import { ArrowDown, ArrowUp, Info, PencilLine, RefreshCw, X } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { Spinner } from "../components/ui/spinner";
import { Choice } from "../components/Choice";
import { Detail, FieldRow, Panel, PanelFooter, StatusLabel } from "../components/WorkspacePage";
import { useLocale } from "../useLocale";
import { CopyableText } from "../shell/CopyableText";
import { createVoucherItems, voucherClient, voucherError } from "./client";
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatRouterTime,
  formatVoucherValue,
} from "./format";
import { formatNumber } from "../locale";
import { RemainingCell } from "./VoucherCells";
import { InspectorFields } from "./VoucherFields";

const voucherStates = {
  online: { label: "Online", tone: "success" },
  enabled: { label: "Enabled", tone: "ready" },
  disabled: { label: "Disabled", tone: "muted" },
} as const;

export function VoucherState({ voucher }: { voucher: Voucher }) {
  const { t } = useLocale();
  const state =
    voucherStates[
      voucher.disabled ? "disabled" : (voucher.activeSessions ?? 0) > 0 ? "online" : "enabled"
    ];
  return (
    <StatusLabel tone={state.tone} className="text-sm">
      {t(state.label)}
    </StatusLabel>
  );
}

export function VoucherCreateForm({
  catalog,
  customer,
  onReview,
  onCancel,
}: {
  catalog: VoucherCatalog;
  customer: string;
  onReview: (action: VoucherAction) => void;
  onCancel: () => void;
}) {
  const { t, locale } = useLocale();
  const id = useId();
  const [count, setCount] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [prefix, setPrefix] = useState("");
  const [profile, setProfile] = useState("");
  const [sharedUsers, setSharedUsers] = useState(1);
  const [comment, setComment] = useState("");
  const override = catalog.profiles.find((item) => item.name === profile)?.overrideSharedUsers;
  return (
    <Panel>
      <form
        aria-labelledby={`${id}-title`}
        onSubmit={(event) => {
          event.preventDefault();
          const items = createVoucherItems(count, username, password, prefix);
          onReview({ kind: "create", items, profile, sharedUsers, comment });
        }}
      >
        <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-4">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {t("Create vouchers")}
          </h2>
          <Button variant="ghost-muted" size="icon-sm" aria-label={t("Close")} onClick={onCancel}>
            <X />
          </Button>
        </div>
        <div className="divide-y divide-border/50 border-t border-border/50">
          <FieldRow
            controlId={`${id}-count`}
            label={t("Quantity")}
            description={t("Create up to {count} vouchers at once.", {
              count: formatNumber(100, locale),
            })}
          >
            <Input
              id={`${id}-count`}
              aria-describedby={`${id}-count-description`}
              type="number"
              dir="ltr"
              required
              min={1}
              max={100}
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </FieldRow>
          {count === 1 ? (
            <>
              <FieldRow
                controlId={`${id}-username`}
                label={t("Username")}
                description={t("Leave blank to generate one.")}
              >
                <Input
                  id={`${id}-username`}
                  aria-describedby={`${id}-username-description`}
                  dir="ltr"
                  autoComplete="off"
                  maxLength={128}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </FieldRow>
              <FieldRow
                controlId={`${id}-password`}
                label={t("Password")}
                description={t("Leave blank to create the voucher without a password.")}
              >
                <Input
                  id={`${id}-password`}
                  aria-describedby={`${id}-password-description`}
                  type="text"
                  dir="ltr"
                  autoComplete="new-password"
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </FieldRow>
            </>
          ) : (
            <FieldRow
              controlId={`${id}-prefix`}
              label={t("Username prefix")}
              description={t("Generated usernames start with this text.")}
            >
              <Input
                id={`${id}-prefix`}
                aria-describedby={`${id}-prefix-description`}
                dir="ltr"
                autoComplete="off"
                maxLength={32}
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
            </FieldRow>
          )}
          <FieldRow label={t("Profile")}>
            <Choice
              label={t("Profile")}
              value={profile}
              onChange={setProfile}
              options={[
                { value: "", label: t("No profile") },
                ...catalog.profiles
                  .filter((item) => !item.owner || item.owner === customer)
                  .map((item) => ({
                    value: item.name,
                    label: item.validity
                      ? t("{name}, valid for {duration}", {
                          name: item.name,
                          duration: formatDuration(item.validity, locale),
                        })
                      : item.name,
                  })),
              ]}
            />
          </FieldRow>
          <FieldRow
            controlId={`${id}-shared`}
            label={t("Shared users")}
            description={
              override === undefined || override === null
                ? undefined
                : t("The {profile} profile sets this to {count} when it is activated.", {
                    profile,
                    count:
                      override === "unlimited" ? t("Unlimited") : formatNumber(override, locale),
                  })
            }
          >
            <Input
              id={`${id}-shared`}
              aria-describedby={
                override === undefined || override === null ? undefined : `${id}-shared-description`
              }
              type="number"
              dir="ltr"
              required
              min={1}
              max={1000}
              value={sharedUsers}
              onChange={(event) => setSharedUsers(Number(event.target.value))}
            />
          </FieldRow>
          <FieldRow controlId={`${id}-comment`} label={t("Comment")}>
            <Input
              id={`${id}-comment`}
              dir="auto"
              maxLength={512}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </FieldRow>
        </div>
        <PanelFooter>
          <p className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">
            {t(
              "A selected profile is added and activated after each voucher is created. Generated credentials can be exported after confirmation.",
            )}
          </p>
          <Button variant="outline" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit">{t("Review creation")}</Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}

const noFields: readonly VoucherField[] = [];
const noop = () => {};

export function VoucherInspector({
  row,
  scope,
  connected,
  onReview,
  onClose,
  fields = noFields,
  onFieldsSaved = noop,
}: {
  row: VoucherRow;
  scope: VoucherScope;
  connected: boolean;
  onReview: (action: VoucherAction) => void;
  onClose: () => void;
  fields?: readonly VoucherField[];
  onFieldsSaved?: () => void;
}) {
  const { t, locale } = useLocale();
  const titleId = useId();
  const [details, setDetails] = useState<VoucherDetails | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(connected);
  const [editing, setEditing] = useState(false);
  const voucher = details?.voucher ?? row;
  async function refresh() {
    setLoading(true);
    setError("");
    await voucherClient
      .details({ ...scope, id: row.id })
      .then(setDetails, (error) => setError(voucherError(error)));
    setLoading(false);
  }
  useEffect(() => {
    if (!connected) return;
    let active = true;
    void voucherClient.details({ ...scope, id: row.id }).then(
      (result) => {
        if (active) {
          setDetails(result);
          setLoading(false);
        }
      },
      (error) => {
        if (active) {
          setError(voucherError(error));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [connected, row.id, scope]);
  return (
    <section aria-labelledby={titleId} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
        <h2 id={titleId} className="text-base font-semibold">
          {t("Voucher details")}
        </h2>
        <Button variant="ghost-muted" size="icon-sm" aria-label={t("Close")} onClick={onClose}>
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6">
        <div className="rounded-xl bg-primary/6">
          <div className="space-y-4 p-4">
            <div className="flex items-start justify-between gap-3">
              <CopyableText value={voucher.username} label={t("Username")} size="large" />
              <VoucherState voucher={voucher} />
            </div>
            {connected && details?.password !== null && details?.password !== undefined ? (
              <CopyableText value={details.password} label={t("Password")} size="large" />
            ) : connected && loading ? (
              <div className="space-y-1.5">
                <span className="block text-xs text-muted-foreground">{t("Password")}</span>
                <Skeleton className="h-6 w-32" />
              </div>
            ) : null}
          </div>
          <div
            aria-hidden="true"
            className="relative mx-4 border-t border-dashed border-foreground/15"
          >
            <span className="absolute -start-6 top-0 size-4 -translate-y-1/2 rounded-full bg-popover" />
            <span className="absolute -end-6 top-0 size-4 -translate-y-1/2 rounded-full bg-popover" />
          </div>
          <dl className="grid grid-cols-2 gap-4 p-4">
            <Detail label={t("Profile")}>
              <bdi>{voucher.profile || t("No profile")}</bdi>
            </Detail>
            <Detail label={t("Customer")}>
              <bdi>{voucher.customer}</bdi>
            </Detail>
          </dl>
        </div>
        <section className="space-y-2">
          <h3 className="px-1 text-sm text-foreground/70">{t("Usage")}</h3>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border/60 bg-border/50">
            <Detail label={t("Remaining")} className="col-span-2 bg-popover px-3 py-2.5">
              <RemainingCell row={voucher} />
            </Detail>
            <Detail label={t("Download")} className="bg-popover px-3 py-2.5">
              {formatBytes(voucher.download, locale)}
            </Detail>
            <Detail label={t("Upload")} className="bg-popover px-3 py-2.5">
              {formatBytes(voucher.upload, locale)}
            </Detail>
            <Detail label={t("Uptime")} className="bg-popover px-3 py-2.5">
              {formatDuration(voucher.uptime, locale)}
            </Detail>
            <Detail label={t("Last seen")} className="bg-popover px-3 py-2.5">
              {voucher.lastSeen === "never"
                ? t("Never")
                : formatRouterTime(voucher.lastSeen, locale)}
            </Detail>
            <Detail label={t("Active sessions")} className="bg-popover px-3 py-2.5">
              {formatCount(voucher.activeSessions, locale)}
            </Detail>
            <Detail label={t("Shared users")} className="bg-popover px-3 py-2.5">
              {voucher.sharedUsers === "unlimited"
                ? t("Unlimited")
                : formatCount(voucher.sharedUsers, locale)}
            </Detail>
            <Detail label={t("Created")} className="bg-popover px-3 py-2.5">
              {formatRouterTime(voucher.registrationDate, locale)}
            </Detail>
            <Detail label={t("First login")} className="bg-popover px-3 py-2.5">
              {formatRouterTime(voucher.firstLoginAt, locale)}
            </Detail>
          </dl>
          <p className="flex items-start gap-2 px-1 text-xs text-muted-foreground">
            <Info aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            {t(
              "The router counts usage over the voucher's whole life. Madar calculates what remains of the current profile from the usage it saw since that profile started.",
            )}
          </p>
        </section>
        <InspectorFields row={voucher} scope={scope} fields={fields} onSaved={onFieldsSaved} />
        {voucher.comment ? (
          <section className="space-y-1">
            <h3 className="px-1 text-sm text-foreground/70">{t("Comment")}</h3>
            <p className="px-1 text-sm whitespace-pre-wrap">
              <bdi>{voucher.comment}</bdi>
            </p>
          </section>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!connected || loading}
            onClick={() => void refresh()}
          >
            {loading ? <Spinner aria-hidden="true" role="presentation" /> : <RefreshCw />}
            {t(loading ? "Loading…" : "Refresh details and sessions")}
          </Button>
          <Button
            variant={editing ? "secondary" : "outline"}
            size="sm"
            aria-expanded={editing}
            disabled={!connected}
            onClick={() => setEditing(!editing)}
          >
            <PencilLine />
            {t("Edit voucher")}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {editing && (
          <VoucherEditForm
            key={voucher.id}
            voucher={voucher}
            onReview={onReview}
            onCancel={() => setEditing(false)}
          />
        )}
        {details && (
          <section className="space-y-2">
            <h3 className="px-1 text-sm text-foreground/70">{t("Recent sessions")}</h3>
            {!details.sessionsAvailable ? (
              <p className="px-1 text-sm text-muted-foreground">
                {t("Session details are unavailable. Voucher details were refreshed.")}
              </p>
            ) : details.sessions.length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                {t("No sessions returned by the router.")}
              </p>
            ) : (
              <ul className="max-h-72 divide-y divide-border/50 overflow-auto rounded-xl border border-border/60">
                {details.sessions.map((session, i) => (
                  <li key={session[".id"] ?? i} className="space-y-1 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm tabular-nums">
                        <span className="sr-only">{t("Started")} </span>
                        {formatVoucherValue(
                          session.started ?? session["from-time"],
                          "started",
                          locale,
                        )}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        <span className="sr-only">{t("Uptime")} </span>
                        {formatVoucherValue(session.uptime, "uptime", locale)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
                      <span>
                        {t("Ended")}{" "}
                        {formatVoucherValue(session.ended ?? session["till-time"], "ended", locale)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ArrowDown aria-hidden="true" className="size-3" />
                        <span className="sr-only">{t("Download")} </span>
                        {formatVoucherValue(session.download, "download", locale)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <ArrowUp aria-hidden="true" className="size-3" />
                        <span className="sr-only">{t("Upload")} </span>
                        {formatVoucherValue(session.upload, "upload", locale)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

function VoucherEditForm({
  voucher,
  onReview,
  onCancel,
}: {
  voucher: Voucher;
  onReview: (action: VoucherAction) => void;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const id = useId();
  const [username, setUsername] = useState(voucher.username);
  const [password, setPassword] = useState("");
  const [comment, setComment] = useState(voucher.comment);
  const [sharedUsers, setSharedUsers] = useState(
    typeof voucher.sharedUsers === "number" ? Math.max(1, voucher.sharedUsers) : 1,
  );
  return (
    <Panel>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onReview({
            kind: "edit",
            id: voucher.id,
            username,
            sharedUsers,
            comment,
            ...(password ? { password } : {}),
          });
        }}
      >
        <div className="divide-y divide-border/50">
          <FieldRow controlId={`${id}-username`} label={t("Username")}>
            <Input
              id={`${id}-username`}
              required
              type="text"
              dir="ltr"
              autoComplete="off"
              maxLength={128}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </FieldRow>
          <FieldRow controlId={`${id}-password`} label={t("New password (blank keeps current)")}>
            <Input
              id={`${id}-password`}
              type="text"
              dir="ltr"
              autoComplete="new-password"
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </FieldRow>
          <FieldRow controlId={`${id}-comment`} label={t("Comment")}>
            <Input
              id={`${id}-comment`}
              dir="auto"
              maxLength={512}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </FieldRow>
          <FieldRow controlId={`${id}-shared`} label={t("Shared users")}>
            <Input
              id={`${id}-shared`}
              type="number"
              dir="ltr"
              min={1}
              max={1000}
              required
              value={sharedUsers}
              onChange={(event) => setSharedUsers(Number(event.target.value))}
            />
          </FieldRow>
        </div>
        <PanelFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button type="submit" size="sm">
            {t("Review changes")}
          </Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}
