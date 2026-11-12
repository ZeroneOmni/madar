import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  RouterProbeResult,
  type RouterProbeInput,
} from "@madar/contracts";
import * as Schema from "effect/Schema";

const decodeResult = Schema.decodeUnknownSync(RouterProbeResult);
function localBackend() {
  return window.desktopBridge
    ?.getLocalEnvironmentBootstraps()
    .find(({ id }) => id === PRIMARY_LOCAL_ENVIRONMENT_ID);
}
function endpoint(path: string) {
  const base = localBackend()?.httpBaseUrl;
  return base ? new URL(path, base).href : path;
}
async function signIn(credential: string) {
  const response = await fetch(endpoint("/api/auth/browser-session"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok)
    throw new Error("Madar sign-in failed. Reopen the app or use a fresh pairing link.");
}
export async function initializeAppSession() {
  const token =
    window.location.pathname === "/pair"
      ? new URLSearchParams(window.location.hash.slice(1)).get("token")
      : null;
  if (token) await signIn(token);
  if (token) window.history.replaceState(null, "", "/#/routers");
}
export async function probeRouter(input: RouterProbeInput, signal: AbortSignal) {
  const send = async () => {
    const bridge = window.desktopBridge;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (bridge) headers.Authorization = `Bearer ${await bridge.getLocalEnvironmentBearerToken()}`;
    return fetch(endpoint("/api/routers/probe"), {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      credentials: bridge ? "omit" : "include",
      signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
    });
  };
  const response = await send();
  if (!response.ok) throw new Error("Router check unavailable");
  return decodeResult(await response.json());
}
