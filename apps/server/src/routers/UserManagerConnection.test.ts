import { it } from "@effect/vitest";
import { expect, vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/http";
import type { RouterProbeInput } from "@madar/contracts";
import { DOMParser } from "@xmldom/xmldom";
import * as UserManagerConnection from "./UserManagerConnection.ts";

const layerWithFetch = (fetch: typeof globalThis.fetch) =>
  UserManagerConnection.layer.pipe(
    Layer.provide(
      FetchHttpClient.layer.pipe(Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))),
    ),
  );

const input: RouterProbeInput = {
  profile: {
    id: "fixture",
    name: "Example",
    host: "userman.example.test",
    port: 80,
    username: 'customer<&"',
    transport: "user-manager-http",
    color: "blue",
    icon: "router",
    label: "",
  },
  password: 'password<&"',
};
const login =
  '<server-message trans-id="11"><message-part processor="EchoDomUpdate.MessageProcessor"><dom-add><content parent-id="body"><div id="login-form"><input id="login-7" type="text"/><input id="password-8" type="password"/><div id="submit-9"><span>Log in</span></div></div></content></dom-add></message-part><message-part processor="EchoButton.MessageProcessor"><init><button eid="submit-9"/></init></message-part></server-message>';
const authenticated =
  '<server-message trans-id="12"><message-part processor="EchoDomUpdate.MessageProcessor"><dom-remove><item eid="login-form"/></dom-remove><dom-add><content parent-id="body"><div id="logout-23">Logout</div><div id="users-24">Users</div></content></dom-add></message-part><message-part processor="EchoButton.MessageProcessor"><init><button eid="logout-23"/></init></message-part></server-message>';

function fixture({
  rejected = false,
  base = "/userman",
  expired = false,
  logoutRejected = false,
} = {}) {
  let initialized = 0;
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, options) => {
    expect(options?.redirect).toBe("manual");
    const body = String(options?.body ?? "");
    if (options?.method === "GET")
      return new Response(`<script>EchoClientEngine.init('${base}', false)</script>`, {
        headers: { "set-cookie": "fixture_session=one; Path=/; HttpOnly" },
      });
    expect(String(url)).toBe("http://userman.example.test/userman?serviceId=Echo.Synchronize");
    expect(new Headers(options?.headers).get("cookie")).toBe("fixture_session=one");
    if (body.includes('type="initialize"')) {
      initialized++;
      return new Response(login);
    }
    if (body.includes('name="text"')) {
      const message = new DOMParser().parseFromString(body, "text/xml");
      const properties = Array.from(message.getElementsByTagName("property"));
      const username = properties.find(
        (property) => property.getAttribute("component-id") === "login-7",
      );
      const password = properties.find(
        (property) => property.getAttribute("component-id") === "password-8",
      );
      expect(username?.textContent).toBe(input.profile.username);
      expect(password?.textContent).toBe(input.password);
      expect(username?.hasAttribute("value")).toBe(false);
      expect(password?.hasAttribute("value")).toBe(false);
      expect(message.getElementsByTagName("action")[0]?.getAttribute("name")).toBe("click");
      expect(body).toContain('component-id="login-7"');
      expect(body).toContain("customer&lt;&amp;&quot;");
      expect(body).toContain("password&lt;&amp;&quot;");
      expect(body).toContain('component-id="submit-9"');
      expect(body).toContain('trans-id="11"');
      return new Response(
        rejected
          ? '<server-message trans-id="12"><message-part processor="EchoDomUpdate.MessageProcessor"><dom-add><content parent-id="login-form"><div id="error">Invalid password</div></content></dom-add></message-part></server-message>'
          : authenticated,
      );
    }
    expect(body).toContain('trans-id="12"');
    if (body.includes('component-id="logout-23"')) {
      const message = new DOMParser().parseFromString(body, "text/xml");
      expect(message.getElementsByTagName("action")[0]?.getAttribute("name")).toBe("click");
      return new Response(logoutRejected ? authenticated : login);
    }
    return new Response(
      expired
        ? '<server-message trans-id="13"><message-part processor="EchoBrowserCommand.MessageProcessor"><redirect uri="/userman"/></message-part></server-message>'
        : '<server-message trans-id="13"/>',
    );
  });
  return { fetch, initialized: () => initialized };
}

it.effect("authenticates a customer with server-issued fields and reuses the session", () => {
  const server = fixture();
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    const expected = {
      kind: "connected",
      service: "user-manager",
      customer: input.profile.username,
    };
    expect(yield* service.check(input, "owner")).toEqual(expected);
    expect(yield* service.check(input, "owner")).toEqual(expected);
    expect(server.fetch).toHaveBeenCalledTimes(4);
    expect(server.initialized()).toBe(1);
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});
it.effect("reports rejected customer credentials without returning connected", () => {
  const server = fixture({ rejected: true });
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    expect(yield* service.check(input, "owner")).toEqual({
      kind: "failed",
      reason: "authentication",
    });
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});
it.effect("does not send credentials to an unexpected service origin", () => {
  const server = fixture({ base: "http://other.example.test/userman" });
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    expect(yield* service.check(input, "owner")).toEqual({ kind: "failed", reason: "unsupported" });
    expect(server.fetch).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});
it.effect("keeps customer cookies separate between app sessions", () => {
  const server = fixture();
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    yield* service.check(input, "first-owner");
    yield* service.check(input, "second-owner");
    expect(server.initialized()).toBe(2);
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});
it.effect("recognizes an expired session instead of reporting connected", () => {
  const server = fixture({ expired: true });
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    yield* service.check(input, "owner");
    expect(yield* service.check(input, "owner")).toEqual({
      kind: "failed",
      reason: "authentication",
    });
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});
it.effect("disconnects the owning customer's session and requires fresh login afterward", () => {
  const server = fixture();
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    yield* service.check(input, "owner");
    expect(yield* service.disconnect(input.profile.id, "owner")).toBe(true);
    expect(String(server.fetch.mock.calls.at(-1)?.[1]?.body)).toContain('component-id="logout-23"');
    yield* service.check(input, "owner");
    expect(server.initialized()).toBe(2);
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});

it.effect("does not claim logout succeeded when the customer remains authenticated", () => {
  const server = fixture({ logoutRejected: true });
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    yield* service.check(input, "owner");
    expect(yield* service.disconnect(input.profile.id, "owner")).toBe(false);
  }).pipe(Effect.provide(layerWithFetch(server.fetch)));
});

it.effect("rejects oversized responses before parsing or sending credentials", () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("x".repeat(2_000_001)));
  return Effect.gen(function* () {
    const service = yield* UserManagerConnection.UserManagerConnection;
    expect(yield* service.check(input, "owner")).toEqual({ kind: "failed", reason: "protocol" });
    expect(fetch).toHaveBeenCalledTimes(1);
  }).pipe(Effect.provide(layerWithFetch(fetch)));
});
