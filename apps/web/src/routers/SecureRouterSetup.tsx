import { useEffect, useRef, useState } from "react";
import type { RouterProfile, RouterSecureRequest, RouterSecureResult } from "@madar/contracts";
import { ShieldCheck } from "lucide-react";
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
  const [result, setResult] = useState<RouterSecureResult | null>(null);
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
            {t("Encrypt the connection to {host}.", { host: profile.host })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {result?.kind === "ready" ? (
            <div className="space-y-3">
              <ShieldCheck size={28} aria-hidden="true" />
              <p>
                {t(
                  "Madar verified the certificate and signed in over API-SSL. Save to use this connection.",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("Existing native API access is still available on the router.")}
              </p>
              {existing && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "When setup changes the endpoint or account, Madar saves a separate connection. Select the original connection to view its voucher history.",
                  )}
                </p>
              )}
            </div>
          ) : result?.kind === "host-key" ? (
            <div className="space-y-4">
              <p>
                {t(
                  "Is this your router? Only continue on a network you trust. For stronger verification, compare this SSH fingerprint through an existing trusted connection.",
                )}
              </p>
              <CopyableText value={result.fingerprint} label="SSH fingerprint" />
              <p className="text-sm text-muted-foreground">
                {t(
                  "Your password is sent only after you approve this router identity. Madar then creates a certificate if needed and enables API-SSL. Firewall and native API settings are kept.",
                )}
              </p>
            </div>
          ) : result?.kind === "instructions" ? (
            <div className="space-y-4">
              <p>
                {t(
                  "Open WinBox Terminal on this router, paste this setup block, and wait for MADAR_PORT and MADAR_FINGERPRINT. Paste those values below.",
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
              <p className="text-sm text-muted-foreground">
                {t(
                  "The setup keeps any existing API-SSL certificate and port. No private keys leave your router.",
                )}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p>
                {t(
                  "Madar can prepare your router automatically using SSH and the account you entered. You need administrator access.",
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {t(
                  "You will approve the router identity before setup. No certificate downloads or computer settings are needed.",
                )}
              </p>
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
              {t(
                busy === "inspect"
                  ? "Checking router identity…"
                  : busy === "configure"
                    ? "Preparing secure access… This can take up to two minutes. Keep this window open."
                    : busy === "saving"
                      ? "Saving secure connection…"
                      : "Verifying certificate…",
              )}
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
          {result?.kind === "ready" ? (
            <Button
              disabled={!!busy}
              onClick={async () => {
                setBusy("saving");
                try {
                  if (await onReady(result.profile)) onClose();
                  else setError("Could not save the secure connection. Try again.");
                } catch {
                  setError("Could not save the secure connection. Try again.");
                } finally {
                  setBusy(null);
                }
              }}
            >
              {t("Save and connect securely")}
            </Button>
          ) : result?.kind === "host-key" ? (
            <Button
              disabled={!!busy}
              onClick={() =>
                void run({
                  kind: "configure",
                  profile,
                  password,
                  sshPort,
                  hostKey: result.fingerprint,
                })
              }
            >
              {t("Trust router and set up")}
            </Button>
          ) : result?.kind === "instructions" ? (
            <Button
              disabled={
                !!busy ||
                !/^(?:[a-fA-F0-9: -]{40,100})$/.test(fingerprint) ||
                !Number.isInteger(tlsPort) ||
                tlsPort < 1 ||
                tlsPort > 65535
              }
              onClick={() =>
                void run({ kind: "verify", profile, password, port: tlsPort, fingerprint })
              }
            >
              {t("Verify secure connection")}
            </Button>
          ) : (
            <Button
              disabled={!!busy || !Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535}
              onClick={() => void run({ kind: "inspect", profile, sshPort })}
            >
              {t("Continue")}
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
