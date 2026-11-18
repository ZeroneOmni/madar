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
              <p>{t("Certificate and API-SSL sign-in verified.")}</p>
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
              <p>
                {t(
                  "Approve this SSH fingerprint only on a trusted network. Compare it through an existing trusted connection if you can.",
                )}
              </p>
              <CopyableText value={result.fingerprint} label="SSH fingerprint" />
              <p className="text-sm text-muted-foreground">
                {t(
                  "Approval sends your password over SSH and enables API-SSL, creating a certificate if needed.",
                )}
              </p>
            </div>
          ) : result?.kind === "instructions" ? (
            <div className="space-y-4">
              <p>
                {t(
                  "Run the setup block in WinBox Terminal. Enter the reported MADAR_PORT and MADAR_FINGERPRINT below.",
                )}
              </p>
              <details>
                <summary className="cursor-pointer text-sm">{t("Router setup block")}</summary>
                <CopyableText value={result.script} label="Router setup block" />
              </details>
              <label className="block space-y-1">
                <span>{t("API-SSL port")}</span>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  value={tlsPort}
                  onChange={(event) => setTlsPort(Number(event.target.value))}
                />
              </label>
              <label className="block space-y-1">
                <span>{t("Certificate fingerprint")}</span>
                <Input
                  dir="ltr"
                  value={fingerprint}
                  onChange={(event) => setFingerprint(event.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <p>{t("Automatic setup uses SSH and requires a router administrator account.")}</p>
              <details>
                <summary className="cursor-pointer text-sm text-muted-foreground">
                  {t("SSH settings")}
                </summary>
                <label className="mt-3 block space-y-1">
                  <span>{t("SSH port")}</span>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={sshPort}
                    onChange={(event) => setSshPort(Number(event.target.value))}
                  />
                </label>
              </details>
            </div>
          )}
          {busy && (
            <p role="status" className="text-sm text-muted-foreground">
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
