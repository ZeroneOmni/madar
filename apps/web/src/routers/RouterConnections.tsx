import { RouterProfile } from "@madar/contracts";
import * as Schema from "effect/Schema";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Router, Settings2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Choice } from "../components/Choice";
import { useLocale } from "../useLocale";
import { usePrivacySettings } from "../shell/settingsState";
import { CopyableText } from "../shell/CopyableText";
import { navigateShell } from "../shell/routes";
import { randomUUID } from "../lib/utils";
import { probeRouter, disconnectRouter, checkRouter } from "./access";
import { CATALOG_KEY, decodeCatalog, emptyCatalog, saveCatalog, type Catalog } from "./catalog";
import { superviseConnection, type ConnectionState } from "./supervisor";

const reasons = {
  network: "Router unreachable. Check the host, API port, firewall, and API service.",
  tls: "TLS verification failed. Configure a trusted API-SSL certificate matching the router host.",
  timeout: "Router did not respond in time. Check connectivity and the API service.",
  authentication: "Login rejected. Check the username, password, and API access policy.",
  permission: "Router access denied. Check the account's read, write and API permissions.",
  protocol: "Unexpected API response. Check that the port serves the RouterOS binary API.",
  unsupported: "Supported target: RouterOS 6 using the binary API.",
  app: "Madar could not check the router. Check the app connection and sign in again if needed.",
};
function useRouterModel() {
  const [catalog, setCatalog] = useState<Catalog>(() => {
    try {
      return decodeCatalog(localStorage.getItem(CATALOG_KEY));
    } catch {
      return emptyCatalog;
    }
  });
  const [error, setError] = useState("");
  const [session, setSession] = useState<{ id: string; retry: number } | null>(null);
  const [state, setState] = useState<ConnectionState>({ kind: "disconnected" });
  const [closing, setClosing] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!session) return;
    return superviseConnection({
      publish: setState,
      probe: (signal) => checkRouter(session.id, signal),
    });
  }, [session]);
  function update(next: Catalog) {
    try {
      saveCatalog(localStorage, next);
      setCatalog(next);
      setError("");
      return true;
    } catch {
      setError("Could not save routers. Previous settings are still active.");
      return false;
    }
  }
  async function disconnect() {
    generation.current++;
    const id = session?.id ?? catalog.selected;
    setSession(null);
    setState({ kind: "disconnected" });
    if (!id) return;
    setClosing(true);
    await disconnectRouter(id).catch(() =>
      setError("Could not close the router connection. Try disconnecting again."),
    );
    setClosing(false);
  }
  function select(id: string) {
    if (update({ ...catalog, selected: id || null })) void disconnect();
  }
  async function connect(password: string) {
    const profile = catalog.routers.find((router) => router.id === catalog.selected);
    if (!profile || closing) return;
    setSession(null);
    const attempt = ++generation.current;
    setState({ kind: "connecting" });
    const result = await probeRouter({ profile, password }, new AbortController().signal).catch(
      () => ({ kind: "failed", reason: "app" }) as const,
    );
    if (attempt !== generation.current) return;
    setState(result);
    if (result.kind === "connected") setSession({ id: profile.id, retry: 0 });
  }
  return { catalog, error, state, closing, update, select, disconnect, connect };
}
const RouterContext = createContext<ReturnType<typeof useRouterModel> | null>(null);
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const model = useRouterModel();
  return <RouterContext value={model}>{children}</RouterContext>;
}
export function useRouters() {
  const model = useContext(RouterContext);
  if (!model) throw new Error("Router provider missing");
  return model;
}
const labels = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Failed",
};
export function RouterPicker() {
  const { t } = useLocale();
  const { catalog, select, state } = useRouters();
  return (
    <div className="[-webkit-app-region:no-drag] ms-auto flex min-w-0 items-center gap-2 text-sm">
      <Router size={18} aria-hidden="true" />
      <div className="min-w-0 max-w-48 flex-1">
        <Choice
          label={t("Active connection")}
          value={catalog.selected ?? ""}
          onChange={select}
          options={[
            { value: "", label: t("Select connection") },
            ...catalog.routers.map((router) => ({ value: router.id, label: router.name })),
          ]}
        />
      </div>
      <span role="status">{t(labels[state.kind])}</span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("Manage connections")}
        onClick={() => navigateShell("/routers")}
      >
        <Settings2 />
      </Button>
    </div>
  );
}
const blank: RouterProfile = {
  id: "new",
  name: "",
  host: "",
  port: 8729,
  username: "",
  transport: "tls",
  color: "blue",
  icon: "router",
  label: "",
};
const decode = Schema.decodeUnknownSync(RouterProfile);
export function RouterConnections() {
  const { t } = useLocale();
  const { maskSensitive } = usePrivacySettings();
  const model = useRouters();
  const [draft, setDraft] = useState<RouterProfile | null>(null);
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const active = model.catalog.routers.find((router) => router.id === model.catalog.selected);
  const connected =
    model.state.kind === "connected" && model.state.service === "router-api" ? model.state : null;
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-(--workspace-page-padding)">
      <h1 className="text-3xl font-semibold">{t("Connections")}</h1>
      <p className="text-muted-foreground">
        {t(
          "Connect to the RouterOS 6 device hosting User Manager. Use a router account with API access. Passwords stay in memory until you disconnect or close Madar.",
        )}
      </p>
      {model.error && <p role="alert">{t(model.error)}</p>}
      <div className="space-y-4 rounded-xl border p-5">
        <h2 className="font-semibold">{t("Active connection")}</h2>
        {active ? (
          <>
            <p className="font-medium">
              {active.name} · {t(active.transport === "tls" ? "API-SSL" : "Native API")}
            </p>
            <CopyableText
              value={`${active.host}:${active.port}`}
              label={t("Router API address")}
              masked={maskSensitive}
            />
            <p role="status">{t(labels[model.state.kind])}</p>
            {connected && (
              <>
                <CopyableText
                  value={connected.identity}
                  label={t("Router identity")}
                  masked={maskSensitive}
                />
                <p>RouterOS {connected.version}</p>
                <Button onClick={() => navigateShell("/vouchers")}>{t("Open vouchers")}</Button>
              </>
            )}
            {(model.state.kind === "disconnected" || model.state.kind === "failed") && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void model.connect(password);
                  setPassword("");
                }}
              >
                <label className="block space-y-1">
                  <span>{t("Router account password")}</span>
                  <Input
                    type="text"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                {active.transport === "tcp" && (
                  <p className="text-sm text-destructive">
                    {t("Native API is an unencrypted backup. Use it only on a trusted network.")}
                  </p>
                )}
                <Button type="submit" disabled={model.closing}>
                  {t("Connect")}
                </Button>
              </form>
            )}
            {model.state.kind !== "disconnected" && (
              <Button variant="outline" onClick={() => void model.disconnect()}>
                {t("Disconnect")}
              </Button>
            )}
            {(model.state.kind === "failed" || model.state.kind === "reconnecting") && (
              <p role="alert">{t(reasons[model.state.reason])}</p>
            )}
          </>
        ) : (
          <p>{t("Select a saved connection or add one below.")}</p>
        )}
        <p className="text-sm text-muted-foreground">
          {t(
            "API-SSL is the default. TLS failures never silently switch to an unencrypted connection.",
          )}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t("Saved connections")}</h2>
        <Button
          onClick={() => {
            setDraft({ ...blank, id: randomUUID() });
            setFormError("");
          }}
        >
          {t("Add connection")}
        </Button>
      </div>
      {model.catalog.routers.map((router) => (
        <div key={router.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
          <div className="min-w-0 flex-1">
            <p>{router.name}</p>
            <p className="text-sm text-muted-foreground">{router.label}</p>
          </div>
          <Button
            variant="outline"
            disabled={router.id === model.catalog.selected || model.closing}
            onClick={() => model.select(router.id)}
          >
            {t(router.id === model.catalog.selected ? "Selected" : "Select")}
          </Button>
          <Button variant="ghost" onClick={() => setDraft(router)}>
            {t("Edit")}
          </Button>
          <Button variant="ghost" onClick={() => setRemoving(router.id)}>
            {t("Remove")}
          </Button>
          {removing === router.id && (
            <div className="flex w-full items-center gap-3">
              <p>{t("Remove this saved router?")}</p>
              <Button
                variant="destructive"
                onClick={() => {
                  if (router.id === model.catalog.selected) void model.disconnect();
                  if (
                    model.update({
                      routers: model.catalog.routers.filter((item) => item.id !== router.id),
                      selected:
                        model.catalog.selected === router.id ? null : model.catalog.selected,
                    })
                  )
                    setRemoving(null);
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
      ))}
      {draft && (
        <form
          className="space-y-4 rounded-xl border p-5"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              const profile = decode({
                ...draft,
                name: draft.name.trim(),
                host: draft.host.trim(),
                username: draft.username.trim(),
              });
              if (
                model.update({
                  routers: [
                    ...model.catalog.routers.filter((router) => router.id !== profile.id),
                    profile,
                  ],
                  selected: model.catalog.selected ?? profile.id,
                })
              ) {
                if (model.catalog.selected === profile.id) void model.disconnect();
                setDraft(null);
              }
            } catch {
              setFormError("Check the connection fields and try again.");
            }
          }}
        >
          <h2 className="font-semibold">{t("Router connection")}</h2>
          {(
            [
              ["name", "Connection name"],
              ["host", "Hostname or IP address"],
              ["username", "Router account username"],
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
            <span>{t("Connection method")}</span>
            <Choice
              label={t("Connection method")}
              value={draft.transport}
              options={[
                { value: "tls", label: t("API-SSL (recommended)") },
                { value: "tcp", label: t("Native API (backup)") },
              ]}
              onChange={(value) =>
                setDraft({
                  ...draft,
                  transport: value === "tcp" ? "tcp" : "tls",
                  port: value === "tcp" ? 8728 : 8729,
                })
              }
            />
          </label>
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
