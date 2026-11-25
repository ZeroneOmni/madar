import { RouterProfile } from "@madar/contracts";
import * as Schema from "effect/Schema";
import { createContext, useContext, useId, useRef, useState } from "react";
import {
  CircleAlert,
  KeyRound,
  Plus,
  Router,
  Settings2,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Choice } from "../components/Choice";
import {
  Detail,
  Disclosure,
  FieldRow,
  IconAction,
  IconTile,
  Notice,
  PageFrame,
  PageHeader,
  PageSection,
  Panel,
  PanelFooter,
  StatusDot,
  StatusLabel,
  type DotTone,
} from "../components/WorkspacePage";
import { useLocale } from "../useLocale";
import { CopyableText } from "../shell/CopyableText";
import { navigateShell } from "../shell/routes";
import { randomUUID } from "../lib/utils";
import { useRouterModel } from "./useRouterModel";
import { RouterDiscovery } from "./RouterDiscovery";
import { RouterDiscoveryProvider } from "./discoveryState";
import { SecureRouterSetup } from "./SecureRouterSetup";
import { RouterDatabaseSettings } from "../vouchers/routerDatabase";

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
type RouterStateKind = ReturnType<typeof useRouterModel>["state"]["kind"];
const routerStateLabels = {
  disconnected: "Disconnected",
  connecting: "Connecting",
  connected: "Connected",
  reconnecting: "Reconnecting",
  failed: "Needs attention",
} satisfies Record<RouterStateKind, string>;
const routerStateTones = {
  disconnected: "muted",
  connecting: "info",
  connected: "success",
  reconnecting: "warning",
  failed: "danger",
} satisfies Record<RouterStateKind, DotTone>;
const stateBadgeVariants = {
  disconnected: "secondary",
  connecting: "info",
  connected: "success",
  reconnecting: "warning",
  failed: "error",
} as const satisfies Record<RouterStateKind, string>;

export function RouterStatusBadge({ kind }: { kind: RouterStateKind }) {
  const { t } = useLocale();
  return (
    <Badge
      role="status"
      aria-label={t("Router connection status")}
      variant={stateBadgeVariants[kind]}
      size="lg"
    >
      <StatusDot tone={routerStateTones[kind]} />
      {t(routerStateLabels[kind])}
    </Badge>
  );
}

const routerTileTones: Record<RouterStateKind, string> = {
  disconnected: "",
  connecting: "",
  connected: "border-success/30 bg-success/8 text-success-foreground",
  failed: "border-destructive/30 bg-destructive/6 text-destructive-foreground",
  reconnecting: "border-warning/30 bg-warning/8 text-warning-foreground",
};

export function RouterTile({ kind, size = "lg" }: { kind: RouterStateKind; size?: "md" | "lg" }) {
  return (
    <IconTile size={size} className={routerTileTones[kind]}>
      <Router />
    </IconTile>
  );
}

export function RouterPicker() {
  const { t } = useLocale();
  const { catalog, select, state } = useRouters();
  if (catalog.routers.length === 0)
    return (
      <div className="[-webkit-app-region:no-drag] ms-auto">
        <Button variant="ghost" size="sm" onClick={() => navigateShell("/routers")}>
          <Plus />
          {t("Add a router")}
        </Button>
      </div>
    );
  return (
    <div className="[-webkit-app-region:no-drag] ms-auto flex min-w-0 items-center gap-1 text-sm">
      <StatusLabel
        role="status"
        tone={routerStateTones[state.kind]}
        className="px-1 text-xs text-muted-foreground max-sm:sr-only"
      >
        {t(routerStateLabels[state.kind])}
      </StatusLabel>
      <div className="max-w-44 min-w-0">
        <Choice
          size="sm"
          variant="ghost"
          label={t("Active connection")}
          value={catalog.selected ?? ""}
          onChange={select}
          options={[
            { value: "", label: t("Select connection") },
            ...catalog.routers.map((router) => ({ value: router.id, label: router.name })),
          ]}
        />
      </div>
      <IconAction label={t("Manage connections")} onClick={() => navigateShell("/routers")}>
        <Settings2 />
      </IconAction>
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
  const fieldId = useId();
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
  const editing = model.catalog.routers.find(({ id }) => id === draft.id);
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
  function readDraft() {
    const host = draft.host.trim();
    return decode({
      ...draft,
      host,
      name: draft.name.trim() || host,
      username: draft.username.trim(),
    });
  }
  function openSecure() {
    if (draftPassword === null) return;
    try {
      const profile = readDraft();
      setFormError("");
      setSecure({ profile, password: draftPassword });
    } catch {
      setFormError("Enter the router address and username before setting up API-SSL.");
      connectionForm.current?.reportValidity();
    }
  }
  const statusMessage =
    model.state.kind === "disconnected"
      ? "Automatic connection is off. Choose Connect to resume."
      : model.state.kind === "reconnecting"
        ? "Retrying every 30 seconds. Madar will keep trying until the router returns."
        : model.state.kind === "failed"
          ? "Update the connection details to continue."
          : model.catalog.autoConnect
            ? "Connects when Madar opens and recovers automatically after an outage."
            : "Connected for this session. Reopening will require your password.";
  const transportLabel = (router: RouterProfile) =>
    router.transport === "tls" ? t("API-SSL") : t("Native API");
  const busy = draftPassword === null || model.closing || model.state.kind === "connecting";
  return (
    <PageFrame>
      <PageHeader
        title={t("Connections")}
        description={t(
          "Madar manages one RouterOS 6 router through its API. Passwords stay on this device.",
        )}
      />
      {model.error && (
        <Notice tone="error" icon={<CircleAlert />} announce>
          {t(model.error)}
        </Notice>
      )}
      {active && (
        <PageSection title={t("Active connection")}>
          <Panel>
            <div className="flex items-start gap-3 px-4 py-4 sm:px-5">
              <RouterTile kind={model.state.kind} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-base font-semibold">
                  <bdi>{active.name}</bdi>
                </p>
                <p className="text-sm text-muted-foreground">{t(statusMessage)}</p>
              </div>
              <RouterStatusBadge kind={model.state.kind} />
            </div>
            {(model.state.kind === "failed" || model.state.kind === "reconnecting") && (
              <div className="px-4 py-3 sm:px-5">
                <Notice
                  tone={model.state.kind === "failed" ? "error" : "warning"}
                  icon={<TriangleAlert />}
                  announce={model.state.kind === "failed"}
                >
                  {t(reasons[model.state.reason])}
                </Notice>
              </div>
            )}
            <dl className="grid gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-2 sm:px-5">
              <Detail label={t("Router API address")}>
                <CopyableText
                  value={`${active.host}:${active.port}`}
                  label={t("Router API address")}
                  showLabel={false}
                />
              </Detail>
              <Detail label={t("Connection method")}>{transportLabel(active)}</Detail>
              {connected && (
                <>
                  <Detail label={t("Router identity")}>
                    <CopyableText
                      value={connected.identity}
                      label={t("Router identity")}
                      showLabel={false}
                    />
                  </Detail>
                  <Detail label="RouterOS">
                    <span dir="ltr">{connected.version}</span>
                  </Detail>
                </>
              )}
            </dl>
            <RouterDatabaseSettings router={active} connected={connected !== null} />
            {model.state.kind === "disconnected" || model.state.kind === "failed" ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (model.credentialsLoading) return;
                  void model.connect(needsPassword ? password : undefined);
                  setChangingPassword(false);
                  setPassword("");
                }}
              >
                {model.credentialsLoading ? (
                  <p role="status" className="px-4 py-3 text-sm text-muted-foreground sm:px-5">
                    {t("Loading saved password…")}
                  </p>
                ) : needsPassword ? (
                  <FieldRow
                    controlId={`${fieldId}-active-password`}
                    label={t("Router account password")}
                    description={t(
                      "Your password is saved on this device for automatic connection.",
                    )}
                  >
                    <Input
                      id={`${fieldId}-active-password`}
                      aria-describedby={`${fieldId}-active-password-description`}
                      type="text"
                      dir="ltr"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </FieldRow>
                ) : (
                  <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground sm:px-5">
                    <KeyRound aria-hidden="true" className="size-4 shrink-0" />
                    {t("Saved password will be used.")}
                  </p>
                )}
                {active.transport === "tcp" && (
                  <div className="border-t border-border/50 px-4 py-3 sm:px-5">
                    <Notice tone="warning" icon={<ShieldAlert />}>
                      {t(
                        "Native API is unencrypted. Use it on a trusted network, or set up API-SSL.",
                      )}
                    </Notice>
                  </div>
                )}
                <PanelFooter>
                  {model.closeFailed && model.state.kind === "disconnected" && (
                    <Button
                      variant="outline"
                      disabled={model.closing}
                      onClick={() => void model.disconnect()}
                    >
                      {t("Retry disconnect")}
                    </Button>
                  )}
                  {!needsPassword && !model.credentialsLoading && (
                    <Button variant="ghost" onClick={() => setChangingPassword(true)}>
                      {t("Change password")}
                    </Button>
                  )}
                  {model.state.kind === "failed" && (
                    <Button
                      variant="outline"
                      disabled={model.closing}
                      onClick={() => void model.disconnect()}
                    >
                      {t("Disconnect")}
                    </Button>
                  )}
                  <Button type="submit" disabled={model.closing || model.credentialsLoading}>
                    {t("Connect")}
                  </Button>
                </PanelFooter>
              </form>
            ) : (
              <PanelFooter>
                <Button
                  variant="outline"
                  disabled={model.closing}
                  onClick={() => void model.disconnect()}
                >
                  {t("Disconnect")}
                </Button>
                {model.state.kind === "reconnecting" && (
                  <Button onClick={model.retry}>{t("Try now")}</Button>
                )}
                {connected && (
                  <Button onClick={() => navigateShell("/vouchers")}>{t("Open vouchers")}</Button>
                )}
              </PanelFooter>
            )}
          </Panel>
        </PageSection>
      )}
      {model.catalog.routers.length > 0 && (
        <PageSection title={t("Saved connections")}>
          <Panel>
            {model.catalog.routers.map((router) => {
              const selected = router.id === model.catalog.selected;
              return (
                <div key={router.id}>
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                    <RouterTile kind={selected ? model.state.kind : "disconnected"} size="md" />
                    <div className="min-w-0 flex-1 basis-48 space-y-0.5">
                      <p className="flex min-w-0 items-center gap-2">
                        <bdi className="truncate text-sm font-medium">{router.name}</bdi>
                        {selected && (
                          <Badge variant="outline" size="sm">
                            {t("Selected")}
                          </Badge>
                        )}
                      </p>
                      <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                        <span dir="ltr">
                          {router.host}:{router.port}
                        </span>
                        <span>{transportLabel(router)}</span>
                        {router.label ? <bdi>{router.label}</bdi> : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      {!selected && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={model.closing}
                          onClick={() => model.select(router.id)}
                        >
                          {t("Select")}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => resetDraft(router)}>
                        {t("Edit")}
                      </Button>
                      <Button
                        variant="ghost-destructive"
                        size="sm"
                        onClick={() => setRemoving(router.id)}
                      >
                        {t("Remove")}
                      </Button>
                    </div>
                  </div>
                  {removing === router.id && (
                    <div className="flex flex-wrap items-center gap-3 border-t border-destructive/20 bg-destructive/4 px-4 py-3 sm:px-5">
                      <p className="min-w-0 flex-1 text-sm">{t("Remove this saved router?")}</p>
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(null)}>
                        {t("Cancel")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={model.closing}
                        onClick={() => {
                          void model.remove(router.id).then((removed) => {
                            if (removed) setRemoving(null);
                          });
                        }}
                      >
                        {t("Confirm removal")}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </Panel>
        </PageSection>
      )}
      <PageSection title={editing ? t("Edit {name}", { name: editing.name }) : t("Add a router")}>
        <Panel>
          <form
            ref={connectionForm}
            onSubmit={(event) => {
              event.preventDefault();
              if (draftPassword === null) return;
              try {
                void model.save(readDraft(), draftPassword).then((saved) => {
                  if (saved) resetDraft();
                });
              } catch {
                setFormError("Check the connection fields and try again.");
              }
            }}
          >
            {!editing && (
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
            )}
            <div className="divide-y divide-border/50 border-t border-border/50 first:border-t-0">
              <FieldRow controlId={`${fieldId}-host`} label={t("Hostname or IP address")}>
                <Input
                  id={`${fieldId}-host`}
                  required
                  dir="ltr"
                  autoComplete="off"
                  value={draft.host}
                  onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                />
              </FieldRow>
              <FieldRow controlId={`${fieldId}-username`} label={t("Router account username")}>
                <Input
                  id={`${fieldId}-username`}
                  required
                  dir="ltr"
                  autoComplete="username"
                  value={draft.username}
                  onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                />
              </FieldRow>
              <FieldRow
                controlId={`${fieldId}-password`}
                label={t("Router account password")}
                description={t("Your password is saved on this device for automatic connection.")}
              >
                <Input
                  id={`${fieldId}-password`}
                  aria-describedby={`${fieldId}-password-description`}
                  type="text"
                  dir="ltr"
                  autoComplete="current-password"
                  value={draftPassword ?? ""}
                  onChange={(event) => {
                    draftRequest.current++;
                    setDraftPassword(event.target.value);
                  }}
                />
              </FieldRow>
              <Disclosure title={t("Advanced")}>
                <div className="divide-y divide-border/50 border-t border-border/50">
                  <FieldRow controlId={`${fieldId}-name`} label={t("Connection name (optional)")}>
                    <Input
                      id={`${fieldId}-name`}
                      dir="auto"
                      value={draft.name}
                      placeholder={draft.host}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </FieldRow>
                  <FieldRow label={t("Connection method")}>
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
                  </FieldRow>
                  {customPort && (
                    <>
                      <FieldRow label={t("Protocol")}>
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
                      </FieldRow>
                      <FieldRow controlId={`${fieldId}-port`} label={t("Port")}>
                        <Input
                          id={`${fieldId}-port`}
                          type="number"
                          dir="ltr"
                          required
                          min={1}
                          max={65535}
                          value={draft.port}
                          onChange={(event) =>
                            setDraft({ ...draft, port: Number(event.target.value) })
                          }
                        />
                      </FieldRow>
                    </>
                  )}
                </div>
              </Disclosure>
            </div>
            {(formError || draft.transport === "tcp") && (
              <div className="space-y-3 border-t border-border/50 px-3 py-3 sm:px-4">
                {formError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t(formError)}
                  </p>
                )}
                {draft.transport === "tcp" && (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <ShieldAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                    {t(
                      "Native API is unencrypted. Use it on a trusted network, or set up API-SSL.",
                    )}
                  </p>
                )}
              </div>
            )}
            <PanelFooter>
              <div className="me-auto">
                <Button variant="ghost" size="sm" disabled={busy} onClick={openSecure}>
                  {t("Set up API-SSL")}
                </Button>
              </div>
              <Button variant="outline" onClick={() => resetDraft()}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={busy}>
                {t("Save and connect")}
              </Button>
            </PanelFooter>
          </form>
        </Panel>
      </PageSection>
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
    </PageFrame>
  );
}
