import { describe, expect, it } from "vite-plus/test";

import { encodeOAuthScope, parseAllowedOAuthScope, parseOAuthScope } from "./oauthScope.ts";

describe("OAuth scopes", () => {
  it("parses an RFC 6749 space-delimited scope set without duplicating permissions", () => {
    expect(parseOAuthScope("diagnostics:read access:write diagnostics:read")).toEqual([
      "diagnostics:read",
      "access:write",
    ]);
  });

  it("rejects whitespace that is not the SP delimiter or introduces empty tokens", () => {
    expect(parseOAuthScope("diagnostics:read\taccess:write")).toBeNull();
    expect(parseOAuthScope("diagnostics:read  access:write")).toBeNull();
  });

  it("encodes and restricts requested scopes to the allowed capability set", () => {
    expect(encodeOAuthScope(["diagnostics:read", "access:write"])).toBe(
      "diagnostics:read access:write",
    );
    expect(
      parseAllowedOAuthScope({
        value: "diagnostics:read access:write",
        allowedScopes: new Set(["diagnostics:read", "access:write"] as const),
      }),
    ).toEqual(["diagnostics:read", "access:write"]);
    expect(
      parseAllowedOAuthScope({
        value: "diagnostics:read relay:write",
        allowedScopes: new Set(["diagnostics:read", "access:write"] as const),
      }),
    ).toBeNull();
  });
});
