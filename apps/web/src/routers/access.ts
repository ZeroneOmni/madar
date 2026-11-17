import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  RouterProbeResult,
  RouterDisconnectResult,
  RouterDiscoveryResult,
  type RouterProbeInput,
} from "@madar/contracts";
import * as Schema from "effect/Schema";

const decodeResult = Schema.decodeUnknownSync(RouterProbeResult);
const decodeDisconnect = Schema.decodeUnknownSync(RouterDisconnectResult);
const decodeDiscovery = Schema.decodeUnknownSync(RouterDiscoveryResult);
export async function discoverRouters(signal: AbortSignal) {
  const response = await routerRequest(
    "/api/routers/discover",
    undefined,
    AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  );
  if (!response.ok) throw new Error("Discovery unavailable");
  return decodeDiscovery(await response.json());
}
function localBackend() {
  return window.desktopBridge
    ?.getLocalEnvironmentBootstraps()
    .find(({ id }) => id === PRIMARY_LOCAL_ENVIRONMENT_ID);
}
function endpoint(path: string) {
  const base = localBackend()?.httpBaseUrl;
  return base ? new URL(path, base).href : path;
}
export async function routerRequest(path: string, input: unknown, signal?: AbortSignal) {
  const bridge = window.desktopBridge;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (bridge) headers.Authorization = `Bearer ${await bridge.getLocalEnvironmentBearerToken()}`;
  return fetch(endpoint(path), {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    credentials: bridge ? "omit" : "include",
    signal: signal ?? AbortSignal.timeout(300000),
  });
}
export async function checkRouter(profileId: string, signal: AbortSignal) {
  const response = await routerRequest(
    "/api/routers/status",
    { profileId },
    AbortSignal.any([signal, AbortSignal.timeout(75000)]),
  );
  if (!response.ok) throw new Error("Router check unavailable");
  return decodeResult(await response.json());
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
  const response = await routerRequest(
    "/api/routers/probe",
    input,
    AbortSignal.any([signal, AbortSignal.timeout(20000)]),
  );
  if (!response.ok) throw new Error("Router check unavailable");
  return decodeResult(await response.json());
}

export async function disconnectRouter(profileId: string) {
  const response = await routerRequest(
    "/api/routers/disconnect",
    { profileId },
    AbortSignal.timeout(8000),
  );
  if (!response.ok || !decodeDisconnect(await response.json()).disconnected)
    throw new Error("Session could not be closed");
}

export async function probeRouterWithFallback(input: RouterProbeInput, signal: AbortSignal) {
  const result = await probeRouter(input, signal);
  signal.throwIfAborted();
  if (
    input.profile.transport !== "tls" ||
    input.profile.port !== 8729 ||
    result.kind !== "failed" ||
    !["network", "timeout", "tls", "protocol"].includes(result.reason)
  )
    return { profile: input.profile, result };
  const profile = { ...input.profile, transport: "tcp" as const, port: 8728 };
  const fallback = await probeRouter({ ...input, profile }, signal);
  signal.throwIfAborted();
  return { profile: fallback.kind === "connected" ? profile : input.profile, result: fallback };
}
