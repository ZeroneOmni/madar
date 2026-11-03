import { useSyncExternalStore } from "react";
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
function read() {
  return window.location.hash.slice(1) || "/";
}
export function useShellPath() {
  return useSyncExternalStore(subscribe, read, () => "/");
}
export function navigateShell(path: string) {
  if (!path.startsWith("/") || path.startsWith("//")) return;
  window.location.hash = path;
}
