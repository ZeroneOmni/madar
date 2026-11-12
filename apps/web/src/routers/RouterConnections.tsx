import { RouterProfile } from "@madar/contracts";
import { probeRouter, disconnectRouter } from "./access";
import * as Schema from "effect/Schema";
import { createContext, useContext, useEffect, useState } from "react";
import { Building2, Home, Router } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useLocale } from "../useLocale";
import { usePrivacySettings } from "../shell/settingsState";
import { SensitiveText } from "../shell/SensitiveText";
import { navigateShell } from "../shell/routes";
import { randomUUID } from "../lib/utils";
import { CATALOG_KEY, decodeCatalog, emptyCatalog, saveCatalog, type Catalog } from "./catalog";
import { superviseConnection, type ConnectionState } from "./supervisor";

const colors = {
  blue: "text-blue-500",
  green: "text-green-500",
  amber: "text-amber-500",
  red: "text-red-500",
  purple: "text-purple-500",
};
const icons = { router: Router, building: Building2, home: Home };
const decodeProfile = Schema.decodeSync(RouterProfile);
const decodeColor = Schema.decodeUnknownSync(RouterProfile.fields.color);
const decodeIcon = Schema.decodeUnknownSync(RouterProfile.fields.icon);
const decodeTransport = Schema.decodeUnknownSync(RouterProfile.fields.transport);
const connectionMethods = {
  "user-manager-http": { label: "User Manager (HTTP)", port: 80, scheme: "http" },
  "user-manager-https": {
    label: "User Manager (HTTPS)",
    port: 443,
    scheme: "https",
  },
  tls: { label: "Router API account (TLS)", port: 8729, scheme: "tls" },
  tcp: { label: "Router API account (unencrypted)", port: 8728, scheme: "tcp" },
};
const isUserManager = (profile: RouterProfile) => profile.transport.startsWith("user-manager-");
function address(profile: RouterProfile) {
  const host = profile.host.includes(":") ? `[${profile.host}]` : profile.host;
  return isUserManager(profile)
    ? `${connectionMethods[profile.transport].scheme}://${host}:${profile.port}/userman`
    : `${host}:${profile.port}`;
}
const userManagerReasons = {
  network: "User Manager is unreachable. Check its address, web port, and web service.",
  tls: "The User Manager HTTPS certificate could not be verified. Check its hostname and certificate.",
  timeout: "User Manager did not respond in time. Check its address, web port, and web service.",
  authentication:
    "User Manager rejected the customer login or the session expired. Check your /userman account details.",
  permission: "This User Manager customer account does not have access.",
  protocol:
    "Madar could not confirm the User Manager customer session. This version may need a compatibility update.",
  unsupported:
    "This address did not provide a supported RouterOS 6 User Manager login page. Check the address and web port.",
  app: "Madar could not check User Manager. Check the app connection and try again.",
};
const reasons = {
  network: "Router unreachable. Check the host, API port, firewall, and API service.",
  tls: "TLS verification failed. Configure a trusted API-SSL certificate matching the router host.",
  timeout: "Router did not respond in time. Check connectivity and the API service.",
  authentication: "Login rejected. Check the username, password, and API access policy.",
  permission:
    "Router access denied. The account needs permission to read system identity and resources.",
  protocol: "Unexpected API response. Check that the port serves the RouterOS binary API.",
  unsupported: "Supported target: RouterOS 6 using the binary API.",
  app: "Madar could not check the router. Check the app connection and sign in again if needed.",
};
function useRouterModel() {
  const [catalog, setCatalog] = useState<Catalog>(emptyCatalog);
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ profile: RouterProfile; password: string } | null>(null);
  const [state, setState] = useState<ConnectionState>({ kind: "disconnected" });
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const load = () => {
      try {
        setCatalog(decodeCatalog(localStorage.getItem(CATALOG_KEY)));
        setError("");
      } catch {
        setCatalog(emptyCatalog);
        setError(
          "Saved routers could not be loaded. Restore storage access or repair the saved catalog.",
        );
      }
    };
    load();
    const changed = (event: StorageEvent) => {
      if (event.key === CATALOG_KEY || event.key === null) {
        setSession(null);
        setState({ kind: "disconnected" });
        load();
      }
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (!session) return;
    return superviseConnection({
      publish: setState,
      probe: (signal) => probeRouter(session, signal),
    });
  }, [session]);
  function update(next: Catalog) {
    try {
      decodeCatalog(localStorage.getItem(CATALOG_KEY));
      saveCatalog(localStorage, next);
      setCatalog(next);
      setError("");
      return true;
    } catch {
      setError("Could not save routers. Previous settings are still active.");
      return false;
    }
  }
  function disconnect() {
    if (session && isUserManager(session.profile)) {
      setClosing(true);
      void disconnectRouter(session.profile.id)
        .catch(() =>
          setError(
            "Could not close the User Manager session. It may remain active until the server expires it.",
          ),
        )
        .finally(() => setClosing(false));
    }
    setSession(null);
    setState({ kind: "disconnected" });
  }
  function select(id: string) {
    if (update({ ...catalog, selected: id || null })) disconnect();
  }
  return {
    catalog,
    error,
    state,
    closing,
    update,
    select,
    disconnect,
    connect: (password: string) => {
      if (closing) return;
      const profile = catalog.routers.find(({ id }) => id === catalog.selected);
      if (profile) {
        setState({ kind: "connecting" });
        setSession({ profile, password });
      }
    },
    retry: () => {
      setState({ kind: "connecting" });
      setSession((current) => (current ? { ...current } : null));
    },
  };
}
const RouterContext = createContext<ReturnType<typeof useRouterModel> | null>(null);
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const model = useRouterModel();
  return <RouterContext value={model}>{children}</RouterContext>;
}
function useRouters() {
  const model = useContext(RouterContext);
  if (!model) throw new Error("Router provider missing");
  return model;
}
const statusLabels = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Failed",
};
export function RouterPicker() {
  const { t } = useLocale();
  const { catalog, select, state } = useRouters();
  const active = catalog.routers.find(({ id }) => id === catalog.selected);
  const Icon = active ? icons[active.icon] : Router;
  return (
    <div className="[-webkit-app-region:no-drag] ms-auto flex min-w-0 items-center gap-2 text-sm">
      <span className={active ? colors[active.color] : "text-muted-foreground"}>
        <Icon size={18} aria-hidden="true" />
      </span>
      <select
        aria-label={t("Active connection")}
        value={catalog.selected ?? ""}
        onChange={(event) => select(event.target.value)}
        className="max-w-48 rounded-md border bg-background p-1"
      >
        <option value="">{t("Select connection")}</option>
        {catalog.routers.map((router) => (
          <option key={router.id} value={router.id}>
            {router.name}
            {router.label ? ` · ${router.label}` : ""}
          </option>
        ))}
      </select>
      <span role="status">{t(statusLabels[state.kind])}</span>
      <Button variant="ghost" size="sm" onClick={() => navigateShell("/routers")}>
        {t("Manage connections")}
      </Button>
    </div>
  );
}
const blankProfile: RouterProfile = {
  id: "new",
  name: "",
  host: "",
  port: 80,
  username: "",
  transport: "user-manager-http",
  color: "blue",
  icon: "router",
  label: "",
};
export function RouterConnections() {
  const { t } = useLocale();
  const { maskSensitive } = usePrivacySettings();
  const model = useRouters();
  const { catalog, state } = model;
  const [draft, setDraft] = useState<RouterProfile | null>(null);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [copied, setCopied] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const active = catalog.routers.find(({ id }) => id === catalog.selected);
  const [lastSelected, setLastSelected] = useState(catalog.selected);
  if (lastSelected !== catalog.selected) {
    setLastSelected(catalog.selected);
    setPassword("");
    setCopied("");
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-(--workspace-page-padding)">
      <h1 className="text-3xl font-semibold">{t("Connections")}</h1>
      <p className="text-sm text-muted-foreground">
        {t(
          "Save your own User Manager address and login. User Manager accounts are separate from router accounts. Passwords are not saved.",
        )}
      </p>
      {model.error && (
        <div className="space-y-2">
          <p role="alert">{t(model.error)}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t("Try again")}
          </Button>
        </div>
      )}
      <div className="space-y-4 rounded-xl border p-5">
        <h2 className="font-semibold">{t("Active connection")}</h2>
        {active ? (
          <>
            <p>
              <bdi>{active.name}</bdi>
              {active.label && (
                <>
                  {" "}
                  · <bdi>{active.label}</bdi>
                </>
              )}
            </p>
            <SensitiveText
              value={address(active)}
              label={t(isUserManager(active) ? "User Manager address" : "Router API address")}
              masked={maskSensitive}
            />
            <p role="status">
              {t(statusLabels[state.kind])}
              {state.kind === "reconnecting" ? ` (${state.attempt}/5)` : ""}
            </p>
            {state.kind === "connected" && state.service === "user-manager" && (
              <div className="space-y-2">
                <p className="font-medium">{t("User Manager sign-in verified")}</p>
                <SensitiveText
                  value={state.customer}
                  label={t("User Manager account (/userman)")}
                  masked={maskSensitive}
                />
              </div>
            )}
            {state.kind === "connected" && state.service === "router-api" && (
              <>
                <SensitiveText
                  value={state.identity}
                  label={t("Router identity")}
                  masked={maskSensitive}
                />
                <p>
                  RouterOS <bdi>{state.version}</bdi>
                </p>
              </>
            )}
            {state.kind === "disconnected" ? (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  model.connect(password);
                  setPassword("");
                }}
              >
                <label className="block space-y-1">
                  <span>
                    {t(isUserManager(active) ? "User Manager password" : "Router account password")}
                  </span>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {active.transport === "tcp" && (
                  <p role="note" className="text-sm text-destructive">
                    {t(
                      "Unencrypted API sends your password over the network. Use only on a trusted network.",
                    )}
                  </p>
                )}
                {active.transport === "user-manager-http" && (
                  <p role="note" className="text-sm text-destructive">
                    {t(
                      "HTTP sends your User Manager login without encryption. Use HTTPS when available.",
                    )}
                  </p>
                )}
                <Button type="submit" disabled={model.closing}>
                  {t(model.closing ? "Signing out…" : "Connect")}
                </Button>
              </form>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" onClick={model.disconnect}>
                  {t("Disconnect")}
                </Button>
                {state.kind === "failed" && (
                  <Button onClick={model.retry}>{t("Retry connection")}</Button>
                )}
              </div>
            )}
            {(state.kind === "failed" || state.kind === "reconnecting") && (
              <div className="space-y-3 rounded-lg border p-4">
                <h3 className="font-medium">{t("Connection diagnosis")}</h3>
                <p role="alert">
                  {t((isUserManager(active) ? userManagerReasons : reasons)[state.reason])}
                </p>
                <Button
                  variant="outline"
                  onClick={async () => {
                    const diagnostics = JSON.stringify(
                      {
                        app: "Madar",
                        target: isUserManager(active)
                          ? "User Manager (RouterOS 6)"
                          : "RouterOS 6 API",
                        transport: active.transport,
                        port: active.port,
                        state: state.kind,
                        reason: state.reason,
                      },
                      null,
                      2,
                    );
                    try {
                      await navigator.clipboard.writeText(diagnostics);
                      setCopied("Diagnostics copied");
                    } catch {
                      setCopied("Could not copy diagnostics");
                    }
                  }}
                >
                  {t("Copy diagnostics")}
                </Button>
                <p role="status">{t(copied)}</p>
              </div>
            )}
          </>
        ) : (
          <p>{t("Select a saved connection or add one below.")}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {t(
            "Madar checks the selected connection every 30 seconds. User Manager sign-in and router API access are different. Voucher and subscription operations are not available yet.",
          )}
        </p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{t("Saved connections")}</h2>
          <Button
            onClick={() => {
              setDraft({ ...blankProfile, id: randomUUID() });
              setFormError("");
            }}
          >
            {t("Add connection")}
          </Button>
        </div>
        {catalog.routers.map((router) => {
          const Icon = icons[router.icon];
          return (
            <div
              key={router.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border p-4"
            >
              <span className={colors[router.color]}>
                <Icon aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p>
                  <bdi>{router.name}</bdi>
                </p>
                <p className="text-sm text-muted-foreground">
                  <bdi>{router.label}</bdi>
                </p>
              </div>
              <Button
                variant="outline"
                disabled={catalog.selected === router.id}
                onClick={() => model.select(router.id)}
              >
                {t(catalog.selected === router.id ? "Selected" : "Select")}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDraft(router);
                  setFormError("");
                }}
              >
                {t("Edit")}
              </Button>
              <Button variant="ghost" onClick={() => setRemoving(router.id)}>
                {t("Remove")}
              </Button>
              {removing === router.id && (
                <div className="flex w-full flex-wrap items-center gap-3">
                  <p>{t("Remove this saved router?")}</p>
                  <Button
                    variant="destructive"
                    onClick={() => {
                      if (
                        model.update({
                          routers: catalog.routers.filter(({ id }) => id !== router.id),
                          selected: catalog.selected === router.id ? null : catalog.selected,
                        })
                      ) {
                        if (catalog.selected === router.id) model.disconnect();
                        setRemoving(null);
                        if (draft?.id === router.id) setDraft(null);
                      }
                    }}
                  >
                    {t("Confirm removal")}
                  </Button>
                  <Button variant="outline" onClick={() => setRemoving(null)}>
                    {t("Cancel")}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {draft && (
        <form
          className="space-y-4 rounded-xl border p-5"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const profile = decodeProfile({
                ...draft,
                name: draft.name.trim(),
                host: draft.host.trim(),
                username: draft.username.trim(),
                label: draft.label.trim(),
              });
              const exists = catalog.routers.some(({ id }) => id === profile.id);
              if (
                model.update({
                  routers: exists
                    ? catalog.routers.map((router) => (router.id === profile.id ? profile : router))
                    : [...catalog.routers, profile],
                  selected: catalog.selected ?? profile.id,
                })
              ) {
                if (catalog.selected === profile.id) model.disconnect();
                setDraft(null);
              }
            } catch {
              setFormError("Enter a name, hostname or IP address, username, and a valid port.");
            }
          }}
        >
          <h2 className="font-semibold">{t("Connection details")}</h2>
          <p className="text-sm text-muted-foreground">
            {t(
              isUserManager(draft)
                ? "Use the account you use on /userman, not your router or Wi-Fi account."
                : "Router API access uses a router account. It does not verify a User Manager account (/userman).",
            )}
          </p>
          {(
            [
              ["name", "Connection name"],
              ["host", "Hostname or IP address"],
              [
                "username",
                isUserManager(draft)
                  ? "User Manager account (/userman)"
                  : "Router account username",
              ],
              ["label", "Short description (optional)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block space-y-1">
              <span>{t(label)}</span>
              <Input
                required={key !== "label"}
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
          <label className="block space-y-1">
            <span>{t("Port")}</span>
            <Input
              type="number"
              required
              min={1}
              max={65535}
              value={draft.port}
              onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("Connection method")}</span>
            <select
              className="rounded-md border bg-background p-2"
              value={draft.transport}
              onChange={(event) => {
                const transport = decodeTransport(event.target.value);
                setDraft({
                  ...draft,
                  transport,
                  port: connectionMethods[transport].port,
                });
              }}
            >
              {Object.entries(connectionMethods).map(([method, { label }]) => (
                <option key={method} value={method}>
                  {t(label)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("Color")}</span>
            <select
              className="rounded-md border bg-background p-2"
              value={draft.color}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  color: decodeColor(event.target.value),
                })
              }
            >
              {Object.keys(colors).map((color) => (
                <option key={color} value={color}>
                  {t(color)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>{t("Icon")}</span>
            <select
              className="rounded-md border bg-background p-2"
              value={draft.icon}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  icon: decodeIcon(event.target.value),
                })
              }
            >
              {Object.keys(icons).map((icon) => (
                <option key={icon} value={icon}>
                  {t(icon)}
                </option>
              ))}
            </select>
          </label>
          {formError && <p role="alert">{t(formError)}</p>}
          <div className="flex gap-2">
            <Button type="submit">{t("Save connection")}</Button>
            <Button variant="outline" onClick={() => setDraft(null)}>
              {t("Cancel")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
