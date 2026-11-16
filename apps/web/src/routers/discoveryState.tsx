import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { RouterDiscoveryResult } from "@madar/contracts";
import { discoverRouters } from "./access";

const REFRESH_INTERVAL = 5000;
type DiscoveryState = {
  result: RouterDiscoveryResult | null;
  searching: boolean;
  error: "app" | "busy" | "unavailable" | "no-network" | null;
};
const DiscoveryContext = createContext<DiscoveryState | null>(null);

export function RouterDiscoveryProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<DiscoveryState>({
    result: null,
    searching: !document.hidden,
    error: null,
  });
  useEffect(() => {
    let disposed = false;
    let pending: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let nextScan = 0;
    async function scan() {
      if (disposed || pending || document.hidden) return;
      clearTimeout(timer);
      const delay = nextScan - Date.now();
      if (delay > 0) {
        timer = setTimeout(() => void scan(), delay);
        return;
      }
      const controller = new AbortController();
      pending = controller;
      const result = await discoverRouters(controller.signal).catch(() => null);
      if (disposed) return;
      pending = null;
      nextScan = Date.now() + REFRESH_INTERVAL;
      setState((previous) => ({
        result: result?.kind === "complete" ? result : previous.result,
        searching: false,
        error: result === null ? "app" : result.kind === "failed" ? result.reason : null,
      }));
      timer = setTimeout(() => {
        if (!document.hidden) setState((previous) => ({ ...previous, searching: true }));
        void scan();
      }, REFRESH_INTERVAL);
    }
    const resume = () => {
      void scan();
    };
    void scan();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      pending?.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, []);
  return <DiscoveryContext value={state}>{children}</DiscoveryContext>;
}

export function useRouterDiscovery() {
  const state = useContext(DiscoveryContext);
  if (!state) throw new Error("Router discovery provider missing");
  return state;
}
