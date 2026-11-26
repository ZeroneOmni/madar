import { useEffect, useRef, useState } from "react";
import type {
  RouterProfile,
  RouterDatabaseFailureReason,
  RouterDatabaseScope,
  RouterDatabaseStage,
  RouterDatabaseStatus,
} from "@madar/contracts";
import { CircleAlert, Database, TriangleAlert } from "lucide-react";
import { Button } from "../components/ui/button";
import { Detail, Notice } from "../components/WorkspacePage";
import { useStableCallback } from "../hooks/useStableCallback";
import { formatDateTime, translate, type Locale } from "../locale";
import { useLocale } from "../useLocale";
import { voucherClient, voucherError } from "./client";

export const runningStages: Record<RouterDatabaseStage, string> = {
  connect: "Connecting to the router…",
  check: "Checking the router database…",
  download: "Copying the router database…",
  verify: "Checking the copy…",
  read: "Reading package usage…",
  save: "Saving package usage…",
};
export const stoppedStages: Record<RouterDatabaseStage, string> = {
  connect: "Stopped while connecting.",
  check: "Stopped while checking the file on the router.",
  download: "Stopped while copying.",
  verify: "Stopped while checking the copy.",
  read: "Stopped while reading the copy.",
  save: "Stopped while saving.",
};
export const failureReasons: Record<RouterDatabaseFailureReason, string> = {
  disconnected: "Connect to the router first.",
  "ssh-off":
    "SSH is off on the router or refused the connection. Turn on the ssh service in IP Services on the router, then try again.",
  authentication:
    "The router rejected the SSH login for this account. Check that the account may log in over SSH.",
  permission:
    "This router account cannot read files over SFTP. Its group needs the ssh and ftp policies; the built-in read and write groups lack ftp.",
  "host-key": "The router's SSH identity changed since Madar last connected.",
  "not-found": "The User Manager database file was not found on the router.",
  "too-large": "The router database is larger than 256 MiB, so Madar did not copy it.",
  network: "The connection to the router was interrupted.",
  timeout: "The router did not respond in time.",
  stalled: "The copy stopped making progress.",
  busy: "The router was busy writing to its User Manager database, so no copy could be read. Madar kept the previous copy.",
  corrupt: "The copied file is not a readable User Manager database. Madar kept the previous copy.",
  schema:
    "This router's User Manager database has a layout Madar does not know, so automatic copies are paused.",
  values: "The router database held values Madar could not read safely.",
  storage: "Madar could not save the copy on this PC. Check available disk space.",
};
/** Failures the operator can act on from Settings; others resolve on a later copy. */
export const actionableFailures = new Set<RouterDatabaseFailureReason>([
  "ssh-off",
  "authentication",
  "permission",
  "host-key",
  "schema",
  "too-large",
  "not-found",
]);

/**
 * When a copy was taken. A busy copy's rows come from commits during its download, so its
 * time is approximate.
 */
export function copyTime(capturedAt: string, busy: boolean, locale: Locale) {
  const time = formatDateTime(capturedAt, locale);
  return busy ? translate(locale, "about {time}, while the router was busy", { time }) : time;
}

/** "Router database, copied {time}" for any value read from a copy. */
export function SourceLabel({ capturedAt, busy }: { capturedAt: string; busy: boolean }) {
  const { t, locale } = useLocale();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Database aria-hidden="true" className="size-3.5 shrink-0" />
      {t("Router database, copied {time}", { time: copyTime(capturedAt, busy, locale) })}
    </span>
  );
}

/** The table or column behind a layout or value failure, kept out of the main sentence. */
export function FailureDetail({ detail }: { detail: string | null }) {
  const { t } = useLocale();
  if (!detail) return null;
  return (
    <span className="mt-1 block text-xs text-muted-foreground">
      {t("Details:")} <bdi dir="ltr">{detail}</bdi>
    </span>
  );
}

/**
 * Router database copy status for one router. Asks again only while a copy is scheduled or
 * running; an idle router costs nothing. `onFinished` hears each copy that ends while watched.
 */
export function useRouterDatabase(
  scope: RouterDatabaseScope,
  onFinished: (status: RouterDatabaseStatus) => void = ignore,
) {
  const [status, setStatus] = useState<RouterDatabaseStatus | null>(null);
  const [error, setError] = useState("");
  // A new object asks again: after a refresh, or after the operator starts or cancels a copy.
  const [request, setRequest] = useState(() => ({ scope }));
  const copying = useRef(false);
  const finished = useStableCallback(onFinished);
  if (JSON.stringify(request.scope) !== JSON.stringify(scope)) setRequest({ scope });
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      voucherClient.databaseStatus(request.scope, abort.signal).then(
        (value) => {
          if (abort.signal.aborted) return;
          setStatus(value);
          if (value.job) copying.current = true;
          else if (copying.current) {
            copying.current = false;
            finished(value);
          }
          const wait = value.job
            ? 1000
            : value.scheduledAt
              ? Math.max(1000, Date.parse(value.scheduledAt) - Date.now() + 1000)
              : null;
          if (wait !== null) timer = setTimeout(() => void load(), wait);
        },
        () => {},
      );
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [request, finished]);
  const check = useStableCallback(() => setRequest({ scope }));
  const act = useStableCallback(async (action: () => Promise<RouterDatabaseStatus>) => {
    setError("");
    await action().then(
      (value) => {
        if (value.job) copying.current = true;
        setStatus(value);
        setRequest({ scope });
      },
      (cause) => setError(voucherError(cause)),
    );
  });
  return {
    status,
    error,
    check,
    start: () => act(() => voucherClient.databaseStart(scope)),
    cancel: () => act(() => voucherClient.databaseCancel(scope)),
    trust: (hostKey: string) => act(() => voucherClient.databaseTrust(scope, hostKey)),
  };
}
const ignore = () => {};

/**
 * Router database copies in Connections: when the last copy was taken, and the one calm,
 * actionable notice when copying needs the operator. The router API keeps working either way.
 */
export function RouterDatabaseSettings({
  router,
  connected,
}: {
  router: RouterProfile;
  connected: boolean;
}) {
  const { t, locale } = useLocale();
  const database = useRouterDatabase({ router });
  const [confirming, setConfirming] = useState(false);
  const status = database.status;
  if (!status) return null;
  const failure =
    status.failure && actionableFailures.has(status.failure.reason) ? status.failure : null;
  const summary = status.job
    ? t(runningStages[status.job.stage])
    : status.capturedAt
      ? t("Copied {time}. Madar reads each package's usage and dates from it.", {
          time: copyTime(status.capturedAt, status.capturedBusy, locale),
        })
      : t("Not copied yet. Madar copies it when it first connects to a router.");
  return (
    <div className="space-y-3 px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56 space-y-0.5">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Database aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            {t("Router database")}
          </p>
          <p role="status" className="text-xs text-muted-foreground">
            {summary}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!connected || status.job !== null}
          onClick={() => void database.start()}
        >
          {t("Update now")}
        </Button>
      </div>
      {database.error && (
        <Notice tone="error" icon={<CircleAlert />} announce>
          {t(database.error)}
        </Notice>
      )}
      {failure && !status.job && (
        <Notice tone="warning" icon={<TriangleAlert />}>
          <span className="block">{t(failureReasons[failure.reason])}</span>
          <FailureDetail detail={failure.detail} />
          <span className="mt-1 block text-xs text-muted-foreground">
            {[
              t(stoppedStages[failure.stage]),
              status.paused
                ? t("Automatic copies are paused until this is fixed.")
                : status.retryAt
                  ? t("Madar tries again automatically after {time}.", {
                      time: formatDateTime(status.retryAt, locale),
                    })
                  : "",
              t("Vouchers and router actions keep working through the router API."),
            ]
              .filter(Boolean)
              .join(" ")}
          </span>
          {failure.reason === "host-key" && status.offeredHostKey && (
            <dl className="mt-3 grid gap-2 text-xs">
              {status.hostKey && (
                <Detail label={t("Trusted identity")}>
                  <bdi dir="ltr" className="font-mono text-xs">
                    {status.hostKey}
                  </bdi>
                </Detail>
              )}
              <Detail label={t("New identity")}>
                <bdi dir="ltr" className="font-mono text-xs">
                  {status.offeredHostKey}
                </bdi>
              </Detail>
            </dl>
          )}
          {failure.reason === "host-key" && status.offeredHostKey && (
            <span className="mt-3 flex flex-wrap items-center gap-2">
              {confirming ? (
                <>
                  <span className="text-xs">
                    {t("Trust it only if you replaced or reset this router.")}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                    {t("Cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setConfirming(false);
                      void database.trust(status.offeredHostKey!);
                    }}
                  >
                    {t("Trust new identity")}
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  {t("Trust new identity…")}
                </Button>
              )}
            </span>
          )}
        </Notice>
      )}
    </div>
  );
}
