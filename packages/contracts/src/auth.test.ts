import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import {
  AuthEnvironmentScopes,
  AuthGrantScopes,
  AuthStandardClientScopes,
  authScopeResponse,
  authScopeRequiredResponse,
  AuthSessionState,
  sessionGrantsScope,
} from "./auth.ts";

const decodeScopes = Schema.decodeUnknownSync(AuthEnvironmentScopes);
const decodeGrantScopes = Schema.decodeUnknownSync(AuthGrantScopes);
const decodeSession = Schema.decodeUnknownSync(AuthSessionState);
const decodeTypedScopes = Schema.decodeSync(AuthEnvironmentScopes);

describe("authorization grants", () => {
  it.each([
    "orchestration:read",
    "orchestration:operate",
    "providers:manage",
    "terminal:read",
    "terminal:operate",
    "filesystem:read",
    "filesystem:write",
    "preview:operate",
    "source-control:write",
    "review:write",
    "relay:read",
    "relay:write",
  ])("rejects retired scope %s", (scope) => {
    expect(() => decodeScopes([scope])).toThrow();
    expect(() => decodeGrantScopes([scope])).toThrow();
  });
  it("roundtrips current grants and permission errors", () => {
    const response = authScopeResponse(AuthStandardClientScopes);
    expect(decodeTypedScopes(response.scopes)).toEqual(AuthStandardClientScopes);
    expect(response.permissions).toEqual(AuthStandardClientScopes);
    expect(authScopeRequiredResponse("settings:write")).toEqual({
      requiredScope: "settings:write",
      requiredPermission: "settings:write",
    });
  });
  it("ignores unknown response permissions without broadening grants", () => {
    const session = decodeSession({
      authenticated: true,
      auth: {
        policy: "loopback-browser",
        bootstrapMethods: [],
        sessionMethods: [],
        sessionCookieName: "session",
      },
      scopes: ["settings:write"],
      permissions: ["future:permission"],
    });
    expect(session.permissions).toEqual([]);
    expect(sessionGrantsScope(session, "settings:write")).toBe(false);
  });
  it("uses exact grants and requires authentication", () => {
    expect(
      sessionGrantsScope({ authenticated: true, scopes: ["settings:write"] }, "settings:write"),
    ).toBe(true);
    expect(
      sessionGrantsScope({ authenticated: true, scopes: ["settings:write"] }, "access:write"),
    ).toBe(false);
    expect(
      sessionGrantsScope({ authenticated: false, scopes: ["settings:write"] }, "settings:write"),
    ).toBe(false);
    expect(
      sessionGrantsScope(
        { authenticated: true, scopes: ["settings:write"], permissions: ["access:read"] },
        "settings:write",
      ),
    ).toBe(false);
  });
});
