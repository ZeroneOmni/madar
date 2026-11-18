import type { RouterProbeInput, RouterProfile } from "@madar/contracts";
import { useEffect, useRef, useState } from "react";
import { useStableCallback } from "../hooks/useStableCallback";
import { checkRouter, disconnectRouter, probeRouter } from "./access";
import {
  CATALOG_KEY,
  decodeCatalog,
  emptyCatalog,
  profileForSave,
  saveCatalog,
  type Catalog,
} from "./catalog";
import { superviseConnection, type ConnectionState } from "./supervisor";

function readCatalog() {
  try {
    return decodeCatalog(localStorage.getItem(CATALOG_KEY));
  } catch {
    return emptyCatalog;
  }
}
function readPassword(profile: RouterProfile) {
  return (
    window.desktopBridge?.routerCredentials?.({ kind: "get", profile }) ?? Promise.resolve(null)
  );
}
function sameAccount(left: RouterProfile, right: RouterProfile) {
  return (
    left.id === right.id &&
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.username === right.username
  );
}

export function useRouterModel() {
  const [initial] = useState(readCatalog);
  const [catalog, setCatalog] = useState(initial);
  const currentCatalog = useRef(catalog);
  const [error, setError] = useState("");
  const [state, setState] = useState<ConnectionState>(
    initial.autoConnect && initial.selected ? { kind: "connecting" } : { kind: "disconnected" },
  );
  const [session, setSession] = useState<{
    input: RouterProbeInput;
    abort: AbortController;
  } | null>(null);
  const [credential, setCredential] = useState<{ profile: RouterProfile; saved: boolean } | null>(
    null,
  );
  const [closing, setClosing] = useState(false);
  const [closeFailed, setCloseFailed] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const credentialRevision = useRef(0);
  const active = catalog.routers.find(({ id }) => id === catalog.selected);
  const credentialsLoading = !!(
    active &&
    (!credential || !sameAccount(active, credential.profile))
  );
  const passwordSaved = !credentialsLoading && credential?.saved === true;

  const update = useStableCallback((next: Catalog) => {
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
  });

  useEffect(() => {
    let disposed = false;
    const revision = credentialRevision.current;
    if (active)
      void readPassword(active)
        .catch(() => null)
        .then((password) => {
          if (!disposed && revision === credentialRevision.current)
            setCredential({ profile: active, saved: password !== null });
        });
    return () => {
      disposed = true;
    };
  }, [active]);

  useEffect(() => {
    const profile = initial.routers.find(({ id }) => id === initial.selected);
    if (!initial.autoConnect || !profile) return;
    const abort = new AbortController();
    pending.current = abort;
    void readPassword(profile)
      .then((password) => {
        if (abort.signal.aborted) return;
        if (password === null) setState({ kind: "failed", reason: "credentials" });
        else setSession({ input: { profile, password }, abort });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ kind: "failed", reason: "credentials" });
      });
    return () => abort.abort();
  }, [initial]);

  useEffect(() => {
    if (!session || session.abort.signal.aborted) return;
    const input = session.input;
    let established = false;
    const cancel = superviseConnection({
      publish: setState,
      probe: async (signal) => {
        const combined = AbortSignal.any([signal, session.abort.signal]);
        try {
          if (established) {
            const result = await checkRouter(input.profile.id, combined);
            if (result.kind === "connected") return result;
            established = false;
            // A restarted backend has lost its in-memory router session.
            if (result.reason !== "authentication") return result;
          }
          const result = await probeRouter(input, combined);
          combined.throwIfAborted();
          established = result.kind === "connected";
          return result;
        } catch (error) {
          established = false;
          throw error;
        }
      },
    });
    stop.current = cancel;
    return cancel;
  }, [session]);

  useEffect(() => () => pending.current?.abort(), []);

  async function disconnect() {
    pending.current?.abort();
    stop.current?.();
    const id = currentCatalog.current.selected;
    setSession(null);
    setState({ kind: "disconnected" });
    update({ ...currentCatalog.current, autoConnect: false });
    if (!id) return true;
    setClosing(true);
    setCloseFailed(false);
    const closed = await disconnectRouter(id).then(
      () => true,
      () => {
        setCloseFailed(true);
        setError(
          "Automatic connection is off, but Madar could not close the router session. Try Disconnect again.",
        );
        return false;
      },
    );
    setClosing(false);
    return closed;
  }
  async function select(id: string) {
    if (closing || id === currentCatalog.current.selected) return;
    if (await disconnect())
      update({ ...currentCatalog.current, selected: id || null, autoConnect: false });
  }
  async function connect(password?: string, profile = active) {
    if (!profile || closing) return;
    credentialRevision.current++;
    setCloseFailed(false);
    pending.current?.abort();
    stop.current?.();
    const abort = new AbortController();
    pending.current = abort;
    setSession(null);
    setState({ kind: "connecting" });
    const value = password ?? (await readPassword(profile).catch(() => null));
    if (abort.signal.aborted) return;
    if (value === null) {
      setState({ kind: "failed", reason: "credentials" });
      return;
    }
    if (!update({ ...currentCatalog.current, selected: profile.id, autoConnect: true })) {
      setState({ kind: "disconnected" });
      return;
    }
    if (password !== undefined) {
      const store = window.desktopBridge?.routerCredentials;
      const saved = store
        ? await store({ kind: "set", profile, password: value }).then(
            () => true,
            () => false,
          )
        : false;
      if (abort.signal.aborted) return;
      setCredential({ profile, saved });
      if (!saved) {
        update({ ...currentCatalog.current, autoConnect: false });
        setError(
          "Your password could not be saved on this device. Reopening will require your password.",
        );
      }
    }
    setSession({ input: { profile, password: value }, abort });
  }
  async function save(draft: RouterProfile, password: string, secureProfileId?: string) {
    const previous = currentCatalog.current.routers.find(({ id }) => id === draft.id);
    const profile = profileForSave(draft, previous, secureProfileId);
    if (!profile) {
      setError("Set up API-SSL again to verify the certificate for the new address or port.");
      return false;
    }
    if (closing || !(await disconnect())) return false;
    if (
      !update({
        routers: [...currentCatalog.current.routers.filter(({ id }) => id !== profile.id), profile],
        selected: profile.id,
        autoConnect: false,
      })
    )
      return false;
    await connect(password, profile);
    return true;
  }
  async function remove(id: string) {
    if (id === currentCatalog.current.selected && !(await disconnect())) return false;
    const removed = await (
      window.desktopBridge?.routerCredentials?.({ kind: "remove", profileId: id }) ??
      Promise.resolve(null)
    ).then(
      () => true,
      () => false,
    );
    if (!removed) {
      setError("Could not remove the saved password. Try removing the router again.");
      return false;
    }
    if (credential?.profile.id === id) {
      setCredential(null);
      credentialRevision.current++;
    }
    return update({
      ...currentCatalog.current,
      routers: currentCatalog.current.routers.filter((router) => router.id !== id),
      selected: currentCatalog.current.selected === id ? null : currentCatalog.current.selected,
    });
  }
  function retry() {
    if (session && !closing) setSession({ ...session });
  }
  return {
    catalog,
    state,
    error,
    closing,
    closeFailed,
    passwordSaved,
    credentialsLoading,
    save,
    select,
    connect,
    disconnect,
    remove,
    retry,
    passwordFor: readPassword,
  };
}
