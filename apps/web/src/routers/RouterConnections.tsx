import { RouterProfile } from "@madar/contracts";
import * as Schema from "effect/Schema";
import { createContext, useContext, useRef, useState } from "react";
import { Router, Settings2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Choice } from "../components/Choice";
import { useLocale } from "../useLocale";
import { CopyableText } from "../shell/CopyableText";
import { navigateShell } from "../shell/routes";
import { randomUUID } from "../lib/utils";
import { useRouterModel } from "./useRouterModel";
import { Badge } from "../components/ui/badge";
import { RouterDiscovery } from "./RouterDiscovery";
import { RouterDiscoveryProvider } from "./discoveryState";
import { SecureRouterSetup } from "./SecureRouterSetup";

const reasons = {
  credentials: "Enter your router password to restore automatic connection.",
  network: "Router unreachable. Check the host, API port, firewall, and API service.",
  tls: "TLS verification failed. Configure a trusted API-SSL certificate matching the router host.",
  timeout: "Router did not respond in time. Check connectivity and the API service.",
  authentication: "Login rejected. Check the username, password, and API access policy.",
  permission: "Router access denied. Check the account's read, write and API permissions.",
  protocol: "Unexpected API response. Check that the port serves the RouterOS binary API.",
  unsupported: "Supported target: RouterOS 6 using the binary API.",
  app: "Madar could not check the router. Check the app connection and sign in again if needed.",
};
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
  failed: "Needs attention",
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
  port: 8728,
  username: "",
  transport: "tcp",
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
  const [changingPassword, setChangingPassword] = useState(false);
  const [draftPassword, setDraftPassword] = useState<string | null>("");
  const [customPort, setCustomPort] = useState(false);
  const [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [secure, setSecure] = useState<{ profile: RouterProfile; password: string } | null>(null);
  const connectionForm = useRef<HTMLFormElement | null>(null);
  const draftRequest = useRef(0);
  const active = model.catalog.routers.find((router) => router.id === model.catalog.selected);
  const connected = model.state.kind === "connected" ? model.state : null;
  const needsPassword =
    (!model.credentialsLoading && !model.passwordSaved) ||
    changingPassword ||
    (model.state.kind === "failed" &&
      ["authentication", "credentials"].includes(model.state.reason));
  function resetDraft(profile = { ...blank, id: randomUUID() }) {
    const request = ++draftRequest.current;
    setDraft(profile);
    setDraftPassword("");
    setCustomPort(profile.port !== (profile.transport === "tls" ? 8729 : 8728));
    setFormError("");
    if (model.catalog.routers.some(({ id }) => id === profile.id)) {
      setDraftPassword(null);
      void model
        .passwordFor(profile)
        .then((value) => {
          if (draftRequest.current === request) setDraftPassword(value ?? "");
        })
        .catch(() => {
          if (draftRequest.current === request)
            setFormError("Could not load the saved password. Enter it before saving.");
        });
    }
  }
  function openSecure() {
    if (draftPassword === null) return;
    try {
      const profile = decode({
        ...draft,
        name: draft.name.trim() || draft.host.trim(),
        host: draft.host.trim(),
        username: draft.username.trim(),
      });
      setFormError("");
      setSecure({ profile, password: draftPassword });
    } catch {
      setFormError("Enter the router address and username before setting up API-SSL.");
      connectionForm.current?.reportValidity();
    }
  }
  return (
    <section className="mx-auto max-w-3xl space-y-6 p-(--workspace-page-padding)">
      <h1 className="text-3xl font-semibold">{t("Connections")}</h1>
      {model.error && <p role="alert">{t(model.error)}</p>}
      {active && (
        <div className="space-y-4 rounded-xl border p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{t("Active connection")}</h2>
            <Badge
              aria-label={t("Router connection status")}
              variant={
                connected ? "success" : model.state.kind === "failed" ? "warning" : "secondary"
              }
              role="status"
            >
              {t(labels[model.state.kind])}
            </Badge>
          </div>
          <p className="font-medium">{active.name}</p>
          <CopyableText value={`${active.host}:${active.port}`} label={t("Router API address")} />
          <p className="text-sm text-muted-foreground">
            {t(
              model.state.kind === "disconnected"
                ? "Automatic connection is off. Choose Connect to resume."
                : model.state.kind === "reconnecting"
                  ? "Retrying every 30 seconds. Madar will keep trying until the router returns."
                  : model.state.kind === "failed"
                    ? "Update the connection details to continue."
                    : model.catalog.autoConnect
                      ? "Connects when Madar opens and recovers automatically after an outage."
                      : "Connected for this session. Reopening will require your password.",
            )}
          </p>
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
                if (model.credentialsLoading) return;
                void model.connect(needsPassword ? password : undefined);
                setChangingPassword(false);
                setPassword("");
              }}
            >
              {model.credentialsLoading ? (
                <p className="text-sm text-muted-foreground">{t("Loading saved password…")}</p>
              ) : needsPassword ? (
                <label className="block space-y-1">
                  <span>{t("Router account password")}</span>
                  <Input
                    type="text"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              ) : (
                <p className="text-sm text-muted-foreground">{t("Saved password will be used.")}</p>
              )}
              {needsPassword && (
                <p className="text-sm text-muted-foreground">
                  {t("Your password is saved on this device for automatic connection.")}
                </p>
              )}
              {active.transport === "tcp" && (
                <p className="text-sm text-destructive">
                  {t("Native API is unencrypted. Use it on a trusted network, or set up API-SSL.")}
                </p>
              )}
              <Button type="submit" disabled={model.closing || model.credentialsLoading}>
                {t("Connect")}
              </Button>
              {!needsPassword && !model.credentialsLoading && (
                <Button variant="ghost" onClick={() => setChangingPassword(true)}>
                  {t("Change password")}
                </Button>
              )}
            </form>
          )}
          {model.closeFailed && model.state.kind === "disconnected" && (
            <Button
              variant="outline"
              disabled={model.closing}
              onClick={() => void model.disconnect()}
            >
              {t("Retry disconnect")}
            </Button>
          )}
          {model.state.kind !== "disconnected" && (
            <div className="flex flex-wrap gap-2">
              {model.state.kind === "reconnecting" && (
                <Button onClick={model.retry}>{t("Try now")}</Button>
              )}
              {connected && (
                <Button onClick={() => navigateShell("/vouchers")}>{t("Open vouchers")}</Button>
              )}
              <Button
                variant="outline"
                disabled={model.closing}
                onClick={() => void model.disconnect()}
              >
                {t("Disconnect")}
              </Button>
            </div>
          )}
          {(model.state.kind === "failed" || model.state.kind === "reconnecting") && (
            <p
              role={model.state.kind === "failed" ? "alert" : undefined}
              className="text-sm text-muted-foreground"
            >
              {t(reasons[model.state.reason])}
            </p>
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
                disabled={model.closing}
                onClick={() => {
                  void model.remove(router.id).then((removed) => {
                    if (removed) setRemoving(null);
                  });
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
          if (draftPassword === null) return;
          try {
            const profile = decode({
              ...draft,
              name: draft.name.trim() || draft.host.trim(),
              host: draft.host.trim(),
              username: draft.username.trim(),
            });
            void model.save(profile, draftPassword).then((saved) => {
              if (saved) resetDraft();
            });
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
            value={draftPassword ?? ""}
            onChange={(event) => {
              draftRequest.current++;
              setDraftPassword(event.target.value);
            }}
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
                { value: "tcp", label: t("Native API") },
                { value: "tls", label: t("API-SSL (already configured)") },
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
        <p className="text-sm text-muted-foreground">
          {t("Your password is saved on this device for automatic connection.")}
        </p>
        <p className="text-sm text-muted-foreground">
          {t(
            draft.transport === "tcp"
              ? "Native API is unencrypted. Use it on a trusted network, or set up API-SSL."
              : "API-SSL verifies the router certificate before sending your password.",
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={draftPassword === null || model.closing || model.state.kind === "connecting"}
          >
            {t("Save and connect")}
          </Button>
          <Button variant="outline" onClick={() => resetDraft()}>
            {t("Cancel")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={draftPassword === null || model.closing || model.state.kind === "connecting"}
            onClick={openSecure}
          >
            {t("Set up API-SSL")}
          </Button>
        </div>
      </form>
      {secure && (
        <SecureRouterSetup
          profile={secure.profile}
          password={secure.password}
          existing={model.catalog.routers.some(({ id }) => id === secure.profile.id)}
          onClose={() => setSecure(null)}
          onReady={async (profile) => {
            const saved = await model.save(profile, secure.password, randomUUID());
            if (saved) resetDraft();
            return saved;
          }}
        />
      )}
    </section>
  );
}
