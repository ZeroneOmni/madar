import { useEffect, useRef, useState } from "react";
import type { RouterProfile, RouterSecureRequest, RouterSecureResult } from "@madar/contracts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Spinner } from "../components/ui/spinner";
import { Notice } from "../components/WorkspacePage";
import { CopyableText } from "../shell/CopyableText";
import { useLocale } from "../useLocale";
import { setupSecureRouter } from "./access";

const errors = {
  network: "Could not reach the router. Check SSH or API-SSL access and firewall settings.",
  authentication: "SSH login rejected. Check the router username and password.",
  "host-key": "The router identity changed. Close setup and verify the router before trying again.",
  permission:
    "This account cannot configure secure access. Use an administrator account or ask your administrator to run the setup in WinBox.",
  unsupported: "Automatic setup supports RouterOS 6. Check the router version.",
  certificate:
    "The certificate could not be verified. Check the fingerprint, router address and certificate dates.",
  api: "Could not sign in over API-SSL. Check the API-SSL port and router account.",
  setup:
    "Setup did not finish. The router may have changed. Use WinBox to check API-SSL before trying again.",
  busy: "Another secure setup is running. Wait for it to finish, then try again.",
};

const pendingMessages = {
  inspect: "Checking router identity…",
  configure: "Preparing secure access… This can take up to two minutes.",
  instructions: "Preparing WinBox instructions…",
  verify: "Verifying secure connection…",
  saving: "Saving secure connection…",
};

function validPort(port: number) {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function SecureRouterSetup({
  profile,
  password,
  existing,
  onClose,
  onReady,
}: {
  profile: RouterProfile;
  password: string;
  existing: boolean;
  onClose: () => void;
  onReady: (profile: RouterProfile) => Promise<boolean>;
}) {
  const { t } = useLocale();
  const [result, setResult] = useState<Exclude<RouterSecureResult, { kind: "failed" }> | null>(
    null,
  );
  const [busy, setBusy] = useState<RouterSecureRequest["kind"] | "saving" | null>(null);
  const [error, setError] = useState("");
  const [sshPort, setSshPort] = useState(22);
  const [tlsPort, setTlsPort] = useState(8729);
  const [fingerprint, setFingerprint] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function run(input: RouterSecureRequest) {
    const abort = new AbortController();
    pending.current = abort;
    setBusy(input.kind);
    setError("");
    try {
      const next = await setupSecureRouter(
        input,
        AbortSignal.any([abort.signal, AbortSignal.timeout(150000)]),
      );
      if (abort.signal.aborted) return;
      if (next.kind === "failed") setError(errors[next.reason]);
      else setResult(next);
    } catch {
      if (!abort.signal.aborted)
        setError(input.kind === "configure" ? errors.setup : errors.network);
    } finally {
      if (!abort.signal.aborted) setBusy(null);
    }
  }
  async function advance() {
    switch (result?.kind) {
      case "ready": {
        setBusy("saving");
        setError("");
        const saved = await onReady(result.profile).catch(() => false);
        setBusy(null);
        if (saved) onClose();
        else setError("Could not save the secure connection. Try again.");
        return;
      }
      case "host-key":
        return run({ kind: "configure", profile, password, sshPort, hostKey: result.fingerprint });
      case "instructions":
        return run({ kind: "verify", profile, password, port: tlsPort, fingerprint });
      default:
        return run({ kind: "inspect", profile, sshPort });
    }
  }
  const action =
    result?.kind === "ready"
      ? "Save and connect securely"
      : result?.kind === "host-key"
        ? "Trust router and set up"
        : result?.kind === "instructions"
          ? "Verify secure connection"
          : "Continue";
  const invalid =
    result?.kind === "instructions"
      ? !validPort(tlsPort) || !/^[a-fA-F0-9: -]{40,100}$/.test(fingerprint)
      : !result && !validPort(sshPort);
  const changingRouter = busy === "configure" || busy === "saving";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !changingRouter) onClose();
      }}
    >
      <DialogPopup showCloseButton={!changingRouter}>
        <DialogHeader>
          <DialogTitle>
            {t(result?.kind === "ready" ? "Secure connection ready" : "Set up API-SSL")}
          </DialogTitle>
          <DialogDescription>
            <bdi dir="ltr">{profile.host}</bdi>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {result?.kind === "ready" ? (
            <div className="space-y-3">
              <Notice tone="success" icon={<ShieldCheck />}>
                {t("Certificate and API-SSL sign-in verified.")}
              </Notice>
              {existing && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "If the address, port, protocol, or account changes, the original connection keeps its voucher history.",
                  )}
                </p>
              )}
            </div>
          ) : result?.kind === "host-key" ? (
            <div className="space-y-4">
              <Notice tone="warning" icon={<ShieldAlert />}>
                {t(
                  "Approve this SSH fingerprint only on a trusted network. Compare it through an existing trusted connection if you can.",
                )}
              </Notice>
              <CopyableText value={result.fingerprint} label="SSH fingerprint" size="block" />
              <p className="text-sm text-muted-foreground">
                {t(
                  "Approval sends your password over SSH and enables API-SSL, creating a certificate if needed.",
                )}
              </p>
            </div>
          ) : result?.kind === "instructions" ? (
            <div className="space-y-4">
              <p className="text-sm">
                {t(
                  "Run the setup block in WinBox Terminal. Enter the reported MADAR_PORT and MADAR_FINGERPRINT below.",
                )}
              </p>
              <CopyableText value={result.script} label="Router setup block" size="block" />
              <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">{t("API-SSL port")}</span>
                  <Input
                    type="number"
                    dir="ltr"
                    min={1}
                    max={65535}
                    value={tlsPort}
                    onChange={(event) => setTlsPort(Number(event.target.value))}
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium">{t("Certificate fingerprint")}</span>
                  <Input
                    dir="ltr"
                    value={fingerprint}
                    onChange={(event) => setFingerprint(event.target.value)}
                    autoComplete="off"
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm">
                {t("Automatic setup uses SSH and requires a router administrator account.")}
              </p>
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-card/40 px-3 py-2.5">
                <span className="text-sm text-muted-foreground">{t("SSH port")}</span>
                <span className="w-24">
                  <Input
                    type="number"
                    dir="ltr"
                    size="sm"
                    min={1}
                    max={65535}
                    value={sshPort}
                    onChange={(event) => setSshPort(Number(event.target.value))}
                  />
                </span>
              </label>
            </div>
          )}
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner size="sm" aria-hidden="true" role="presentation" />
              {t(pendingMessages[busy])}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          )}
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" disabled={changingRouter} onClick={onClose}>
            {t("Cancel")}
          </Button>
          {result?.kind !== "ready" && result?.kind !== "instructions" && (
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void run({ kind: "instructions", profile })}
            >
              {t("Use WinBox instead")}
            </Button>
          )}
          <Button disabled={!!busy || invalid} onClick={() => void advance()}>
            {t(action)}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
