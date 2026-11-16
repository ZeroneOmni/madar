import { useEffect, useState } from "react";
import type {
  Voucher,
  VoucherAction,
  VoucherCatalog,
  VoucherDetails,
  VoucherScope,
} from "@madar/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Choice } from "../components/Choice";
import { useLocale } from "../useLocale";
import { CopyableText } from "../shell/CopyableText";
import { randomCode, voucherClient, voucherError } from "./client";
import { formatVoucherValue } from "./format";

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
  const [count, setCount] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [prefix, setPrefix] = useState("");
  const [profile, setProfile] = useState("");
  const [sharedUsers, setSharedUsers] = useState(1);
  const [comment, setComment] = useState("");
  return (
    <form
      className="space-y-4 rounded-xl border p-5"
      onSubmit={(event) => {
        event.preventDefault();
        const items = Array.from({ length: count }, () => ({
          username: count === 1 && username ? username : prefix + randomCode(),
          password: count === 1 && password ? password : randomCode(12),
        }));
        onReview({ kind: "create", items, profile, sharedUsers, comment });
      }}
    >
      <h2 className="text-lg font-semibold">{t("Create vouchers")}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span>{t("Quantity")}</span>
          <Input
            type="number"
            required
            min={1}
            max={100}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
          />
        </label>
        <label className="space-y-1">
          <span>{t("Shared users")}</span>
          <Input
            type="number"
            required
            min={1}
            max={1000}
            value={sharedUsers}
            onChange={(event) => setSharedUsers(Number(event.target.value))}
          />
        </label>
        {count === 1 ? (
          <>
            <label className="space-y-1">
              <span>{t("Username (blank generates one)")}</span>
              <Input
                maxLength={128}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="space-y-1">
              <span>{t("Password (blank generates one)")}</span>
              <Input
                type="text"
                autoComplete="new-password"
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <label className="space-y-1">
            <span>{t("Username prefix")}</span>
            <Input
              maxLength={32}
              value={prefix}
              onChange={(event) => setPrefix(event.target.value)}
            />
          </label>
        )}
        <label className="space-y-1">
          <span>{t("Profile")}</span>
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
                  label: `${item.name}${item.validity ? ` · ${formatVoucherValue(item.validity, "uptime", locale)}` : ""}`,
                })),
            ]}
          />
        </label>
        <label className="space-y-1">
          <span>{t("Comment")}</span>
          <Input
            maxLength={512}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </label>
      </div>
      <p className="text-sm text-muted-foreground">
        {t(
          "A selected profile is added and activated after each voucher is created. Generated credentials can be exported after confirmation.",
        )}
      </p>
      <div className="flex gap-2">
        <Button type="submit">{t("Review creation")}</Button>
        <Button variant="outline" onClick={onCancel}>
          {t("Cancel")}
        </Button>
      </div>
    </form>
  );
}

export function VoucherInspector({
  row,
  scope,
  connected,
  onReview,
  onClose,
}: {
  row: Voucher;
  scope: VoucherScope;
  connected: boolean;
  onReview: (action: VoucherAction) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLocale();
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
    <aside className="space-y-4 rounded-xl border bg-card p-5" aria-label={t("Voucher details")}>
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold">
          <CopyableText value={voucher.username} label={t("Username")} />
        </div>
        <Button variant="ghost" onClick={onClose}>
          {t("Close")}
        </Button>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        {[
          ["Customer", voucher.customer],
          ["Profile", voucher.profile || t("No profile")],
          ["State", t(voucher.disabled ? "Disabled" : "Enabled")],
          ["Upload", formatVoucherValue(voucher.upload, "upload", locale)],
          ["Download", formatVoucherValue(voucher.download, "download", locale)],
          ["Uptime", formatVoucherValue(voucher.uptime, "uptime", locale)],
          ["Last seen", formatVoucherValue(voucher.lastSeen, "lastSeen", locale)],
          ["Active sessions", voucher.activeSessions || "–"],
          ["Shared users", voucher.sharedUsers || "–"],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{t(label!)}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">{voucher.comment}</p>
      <p className="text-sm text-muted-foreground">
        {t(
          "Exact expiry and profile history are not exposed reliably by the legacy API. No expiry is inferred from session end times.",
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={!connected || loading} onClick={() => void refresh()}>
          {t(loading ? "Loading…" : "Refresh details and sessions")}
        </Button>
        <Button variant="outline" disabled={!connected} onClick={() => setEditing(!editing)}>
          {t("Edit voucher")}
        </Button>
      </div>
      {connected && details?.password !== null && details?.password !== undefined && (
        <div className="flex items-center gap-3">
          <CopyableText value={details.password} label={t("Password")} />
        </div>
      )}
      {error && <p role="alert">{t(error)}</p>}
      {editing && <VoucherEditForm key={voucher.id} voucher={voucher} onReview={onReview} />}
      {details && (
        <div className="space-y-2">
          <h3 className="font-medium">{t("Recent sessions")}</h3>
          {!details.sessionsAvailable ? (
            <p>{t("Session details are unavailable. Voucher details were refreshed.")}</p>
          ) : details.sessions.length === 0 ? (
            <p>{t("No sessions returned by the router.")}</p>
          ) : (
            <div className="max-h-64 overflow-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr>
                    {["Started", "Ended", "Uptime", "Upload", "Download"].map((label) => (
                      <th key={label} className="p-2 text-start">
                        {t(label)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {details.sessions.map((session, i) => (
                    <tr key={session[".id"] ?? i}>
                      {[
                        ["started", session.started ?? session["from-time"]],
                        ["ended", session.ended ?? session["till-time"]],
                        ["uptime", session.uptime],
                        ["upload", session.upload],
                        ["download", session.download],
                      ].map(([field, value]) => (
                        <td key={field} className="border-t p-2">
                          {formatVoucherValue(value, field ?? "", locale)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function VoucherEditForm({
  voucher,
  onReview,
}: {
  voucher: Voucher;
  onReview: (action: VoucherAction) => void;
}) {
  const { t } = useLocale();
  const [username, setUsername] = useState(voucher.username);
  const [password, setPassword] = useState("");
  const [comment, setComment] = useState(voucher.comment);
  const [sharedUsers, setSharedUsers] = useState(Number(voucher.sharedUsers) || 1);
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
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
      <div className="space-y-1">
        <label>
          <span>{t("Username")}</span>
          <Input
            required
            type="text"
            autoComplete="off"
            maxLength={128}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
      </div>
      <label>
        <span>{t("New password (blank keeps current)")}</span>
        <Input
          type="text"
          autoComplete="new-password"
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        <span>{t("Comment")}</span>
        <Input
          maxLength={512}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
        />
      </label>
      <label>
        <span>{t("Shared users")}</span>
        <Input
          type="number"
          min={1}
          max={1000}
          required
          value={sharedUsers}
          onChange={(event) => setSharedUsers(Number(event.target.value))}
        />
      </label>
      <div>
        <Button type="submit">{t("Review changes")}</Button>
      </div>
    </form>
  );
}
