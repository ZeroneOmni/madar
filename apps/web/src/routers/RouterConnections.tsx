import { RouterProfile } from "@madar/contracts";
import * as Schema from "effect/Schema";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { Router, Settings2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Choice } from "../components/Choice";
import { useLocale } from "../useLocale";
import { CopyableText } from "../shell/CopyableText";
import { navigateShell } from "../shell/routes";
import { randomUUID } from "../lib/utils";
import { probeRouterWithFallback, disconnectRouter, checkRouter } from "./access";
import { CATALOG_KEY, decodeCatalog, emptyCatalog, saveCatalog, type Catalog } from "./catalog";
import { superviseConnection, type ConnectionState } from "./supervisor";
import { RouterDiscovery } from "./RouterDiscovery";
import { RouterDiscoveryProvider } from "./discoveryState";

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
  const currentCatalog = useRef(catalog);
  const [session, setSession] = useState<{ id: string } | null>(null);
  const [state, setState] = useState<ConnectionState>({ kind: "disconnected" });
  const [closing, setClosing] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
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
      currentCatalog.current = next;
      setCatalog(next);
      setError("");
      return true;
    } catch {
      setError("Could not save routers. Previous settings are still active.");
      return false;
    }
  }
  async function disconnect() {
    pending.current?.abort();
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
  async function connect(
    password: string,
    profile = catalog.routers.find((router) => router.id === catalog.selected),
  ) {
    if (!profile || closing) return;
    pending.current?.abort();
    const abort = new AbortController();
    pending.current = abort;
    setSession(null);
    setState({ kind: "connecting" });
    const outcome = await probeRouterWithFallback({ profile, password }, abort.signal).catch(
      () => ({ profile, result: { kind: "failed", reason: "app" } }) as const,
    );
    if (abort.signal.aborted) return;
    const { result } = outcome;
    if (outcome.profile.transport !== profile.transport) {
      update({
        ...currentCatalog.current,
        routers: currentCatalog.current.routers.map((router) =>
          router.id === profile.id ? outcome.profile : router,
        ),
      });
    }
    setState(result);
    if (result.kind === "connected") setSession({ id: profile.id });
  }
  return { catalog, error, state, closing, update, select, disconnect, connect };
}
const RouterContext = createContext<ReturnType<typeof useRouterModel> | null>(null);
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const model = useRouterModel();
  return (
    <RouterContext value={model}>
      <RouterDiscoveryProvider>{children}</RouterDiscoveryProvider>
    </RouterContext>
  );
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
  const model = useRouters();
  const [draft, setDraft] = useState<RouterProfile>(() => ({ ...blank, id: randomUUID() }));
  const [password, setPassword] = useState("");
  const [draftPassword, setDraftPassword] = useState("");
  const [customPort, setCustomPort] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const connectionForm = useRef<HTMLFormElement | null>(null);
  const active = model.catalog.routers.find((router) => router.id === model.catalog.selected);
  const connected = model.state.kind === "connected" ? model.state : null;
  function resetDraft(profile = { ...blank, id: randomUUID() }) {
    setDraft(profile);
    setDraftPassword("");
    setCustomPort(profile.port !== (profile.transport === "tls" ? 8729 : 8728));
    setFormError("");
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-(--workspace-page-padding)">
      <h1 className="text-3xl font-semibold">{t("Connections")}</h1>
      {model.error && <p role="alert">{t(model.error)}</p>}
      {active && (
        <div className="space-y-4 rounded-xl border p-5">
          <h2 className="font-semibold">{t("Active connection")}</h2>
          <p className="font-medium">{active.name}</p>
          <CopyableText value={`${active.host}:${active.port}`} label={t("Router API address")} />
          <p role="status">{t(labels[model.state.kind])}</p>
          {connected && (
            <>
              <CopyableText value={connected.identity} label={t("Router identity")} />
              <p>RouterOS {connected.version}</p>
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
            <div className="flex flex-wrap gap-2">
              {connected && (
                <Button onClick={() => navigateShell("/vouchers")}>{t("Open vouchers")}</Button>
              )}
              <Button variant="outline" onClick={() => void model.disconnect()}>
                {t("Disconnect")}
              </Button>
            </div>
          )}
          {(model.state.kind === "failed" || model.state.kind === "reconnecting") && (
            <p role="alert">{t(reasons[model.state.reason])}</p>
          )}
        </div>
      )}
      {model.catalog.routers.length > 0 && (
        <h2 className="font-semibold">{t("Saved connections")}</h2>
      )}
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
          <Button variant="ghost" onClick={() => resetDraft(router)}>
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
      <form
        ref={connectionForm}
        className="space-y-4 rounded-xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const profile = decode({
              ...draft,
              name: draft.name.trim() || draft.host.trim(),
              host: draft.host.trim(),
              username: draft.username.trim(),
            });
            const saved = {
              routers: [
                ...model.catalog.routers.filter((router) => router.id !== profile.id),
                profile,
              ],
              selected: profile.id,
            };
            if (model.update(saved)) {
              void model.connect(draftPassword, profile);
              resetDraft();
            }
          } catch {
            setFormError("Check the connection fields and try again.");
          }
        }}
      >
        <RouterDiscovery
          savedHosts={model.catalog.routers.map((router) => router.host)}
          selectedHost={draft.host}
          onSelect={(router) => {
            resetDraft({
              ...blank,
              id: randomUUID(),
              host: router.host ?? "",
              name: router.identity || router.host || router.mac,
            });
            setFormError(
              router.host
                ? ""
                : "This router has no IP address. Configure an IP address on the router, then enter it here. Madar connects over IP, not MAC.",
            );
            connectionForm.current
              ?.querySelector<HTMLInputElement>(
                router.host ? 'input[autocomplete="username"]' : 'input[autocomplete="off"]',
              )
              ?.focus();
          }}
        />
        <h2 className="font-semibold">{t("Router connection")}</h2>
        {(
          [
            ["host", "Hostname or IP address"],
            ["username", "Router account username"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block space-y-1">
            <span>{t(label)}</span>
            <Input
              required
              autoComplete={key === "username" ? "username" : "off"}
              value={draft[key]}
              onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
            />
          </label>
        ))}
        <label className="block space-y-1">
          <span>{t("Router account password")}</span>
          <Input
            type="text"
            autoComplete="current-password"
            value={draftPassword}
            onChange={(event) => setDraftPassword(event.target.value)}
          />
        </label>
        <details className="space-y-4">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {t("Advanced")}
          </summary>
          <label className="block space-y-1">
            <span>{t("Connection name (optional)")}</span>
            <Input
              value={draft.name}
              placeholder={draft.host}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="block space-y-1">
            <span>{t("Connection method")}</span>
            <Choice
              label={t("Connection method")}
              value={customPort ? "other" : draft.transport}
              options={[
                { value: "tls", label: t("API-SSL (recommended)") },
                { value: "tcp", label: t("Native API (backup)") },
                { value: "other", label: t("Other") },
              ]}
              onChange={(value) => {
                setCustomPort(value === "other");
                if (value === "other") return;
                setDraft({
                  ...draft,
                  transport: value === "tcp" ? "tcp" : "tls",
                  port: value === "tcp" ? 8728 : 8729,
                });
              }}
            />
          </label>
          {customPort && (
            <>
              <label className="block space-y-1">
                <span>{t("Protocol")}</span>
                <Choice
                  label={t("Protocol")}
                  value={draft.transport}
                  options={[
                    { value: "tls", label: t("API-SSL") },
                    { value: "tcp", label: t("Native API") },
                  ]}
                  onChange={(value) =>
                    setDraft({ ...draft, transport: value === "tcp" ? "tcp" : "tls" })
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
            </>
          )}
        </details>
        {formError && <p role="alert">{t(formError)}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={model.closing || model.state.kind === "connecting"}>
            {t("Save and connect")}
          </Button>
          <Button variant="outline" onClick={() => resetDraft()}>
            {t("Cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
}
