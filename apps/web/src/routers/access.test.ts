import { expect, it, vi } from "vite-plus/test";
import {
  discoverRouters,
  initializeAppSession,
  probeRouter,
  probeRouterWithFallback,
} from "./access";
import type { RouterProfile } from "@madar/contracts";

const profile: RouterProfile = {
  id: "fixture",
  name: "Office",
  host: "router.local",
  port: 8729,
  username: "admin",
  transport: "tls",
  color: "blue",
  icon: "router",
  label: "",
};

it("discovers through the local Electron backend with bearer authentication and no credentials", async () => {
  const token = vi.fn().mockResolvedValue("fixture-token");
  vi.stubGlobal("window", {
    desktopBridge: {
      getLocalEnvironmentBootstraps: () => [
        { id: "primary", httpBaseUrl: "http://localhost:1234" },
      ],
      getLocalEnvironmentBearerToken: token,
    },
  });
  using request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ kind: "complete", routers: [] }));
  try {
    expect(await discoverRouters(new AbortController().signal)).toEqual({
      kind: "complete",
      routers: [],
    });
    expect(request).toHaveBeenCalledWith(
      "http://localhost:1234/api/routers/discover",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer fixture-token" },
        credentials: "omit",
        body: undefined,
      }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([Response.json({ kind: "complete", routers: [{}] }), new Response("", { status: 401 })])(
  "rejects failed or malformed discovery responses",
  async (response) => {
    vi.stubGlobal("window", {});
    using _request = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    try {
      await expect(discoverRouters(new AbortController().signal)).rejects.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it.each(["network", "timeout", "tls", "protocol"])(
  "retries %s failures over the standard native API port",
  async (reason) => {
    vi.stubGlobal("window", {});
    const connected = {
      kind: "connected",
      service: "router-api",
      identity: "Office",
      version: "6.49",
    };
    using request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ kind: "failed", reason }))
      .mockResolvedValueOnce(Response.json(connected));
    try {
      const result = await probeRouterWithFallback(
        { profile, password: "fixture" },
        new AbortController().signal,
      );
      expect(result).toEqual({
        profile: { ...profile, transport: "tcp", port: 8728 },
        result: connected,
      });
      expect(request.mock.calls.map(([, init]) => JSON.parse(String(init?.body)))).toEqual([
        { profile, password: "fixture" },
        { profile: { ...profile, transport: "tcp", port: 8728 }, password: "fixture" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it.each([
  { router: profile, result: { kind: "failed", reason: "authentication" } },
  { router: profile, result: { kind: "failed", reason: "permission" } },
  { router: profile, result: { kind: "failed", reason: "unsupported" } },
  { router: { ...profile, port: 1234 }, result: { kind: "failed", reason: "network" } },
  {
    router: { ...profile, transport: "tcp" as const, port: 8728 },
    result: { kind: "failed", reason: "network" },
  },
  {
    router: profile,
    result: { kind: "connected", service: "router-api", identity: "Office", version: "6.49" },
  },
])(
  "preserves the chosen profile without an unnecessary retry: $result.kind $result.reason",
  async ({ router, result }) => {
    vi.stubGlobal("window", {});
    using request = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json(result));
    try {
      expect(
        await probeRouterWithFallback(
          { profile: router, password: "fixture" },
          new AbortController().signal,
        ),
      ).toEqual({ profile: router, result });
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  },
);

it("does not retry a cancelled connection", async () => {
  vi.stubGlobal("window", {});
  const abort = new AbortController();
  using request = vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () => {
    abort.abort();
    return Response.json({ kind: "failed", reason: "network" });
  });
  try {
    await expect(
      probeRouterWithFallback({ profile, password: "fixture" }, abort.signal),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("keeps API-SSL configured when both connection attempts fail", async () => {
  vi.stubGlobal("window", {});
  using request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ kind: "failed", reason: "tls" }))
    .mockResolvedValueOnce(Response.json({ kind: "failed", reason: "network" }));
  try {
    expect(
      await probeRouterWithFallback({ profile, password: "fixture" }, new AbortController().signal),
    ).toEqual({ profile, result: { kind: "failed", reason: "network" } });
    expect(request).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("does not downgrade when the app request fails", async () => {
  vi.stubGlobal("window", {});
  using request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(new Response("", { status: 500 }));
  try {
    await expect(
      probeRouterWithFallback({ profile, password: "fixture" }, new AbortController().signal),
    ).rejects.toThrow("Router check unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("preserves a failed pairing route so startup can show recovery", async () => {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/pair", hash: "#token=expired" },
    history: { replaceState },
  });
  using _fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 401 }));
  try {
    await expect(initializeAppSession()).rejects.toThrow("fresh pairing link");
    expect(replaceState).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("exchanges the startup pairing credential and removes it before routing", async () => {
  const replaceState = vi.fn();
  vi.stubGlobal("window", {
    location: { pathname: "/pair", hash: "#token=fixture" },
    history: { replaceState },
  });
  using _fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  try {
    await initializeAppSession();
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/browser-session",
      expect.objectContaining({
        body: JSON.stringify({ credential: "fixture" }),
        credentials: "include",
      }),
    );
    expect(replaceState).toHaveBeenCalledWith(null, "", "/#/routers");
  } finally {
    vi.unstubAllGlobals();
  }
});
it("uses desktop bearer authentication without cross-site cookies", async () => {
  vi.stubGlobal("window", {
    desktopBridge: {
      getLocalEnvironmentBootstraps: () => [
        { id: "primary", httpBaseUrl: "http://localhost:1234", bootstrapToken: "fixture" },
      ],
      getLocalEnvironmentBearerToken: async () => "desktop-fixture",
    },
  });
  using _fetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    Response.json({
      kind: "connected",
      service: "router-api",
      identity: "Office",
      version: "6.49",
    }),
  );
  try {
    const result = await probeRouter(
      {
        profile: {
          id: "fixture",
          name: "Office",
          host: "router.local",
          port: 8729,
          username: "admin",
          transport: "tls",
          color: "blue",
          icon: "router",
          label: "",
        },
        password: "fixture",
      },
      new AbortController().signal,
    );
    expect(result).toEqual({
      kind: "connected",
      service: "router-api",
      identity: "Office",
      version: "6.49",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:1234/api/routers/probe",
      expect.objectContaining({
        credentials: "omit",
        headers: { "Content-Type": "application/json", Authorization: "Bearer desktop-fixture" },
      }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
it("does not exchange desktop bootstrap credentials for browser cookies on startup", async () => {
  vi.stubGlobal("window", {
    location: { pathname: "/", hash: "" },
    desktopBridge: {
      getLocalEnvironmentBootstraps: () => [
        { id: "primary", httpBaseUrl: "http://localhost:1234", bootstrapToken: "fixture" },
      ],
    },
  });
  using _fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  try {
    await initializeAppSession();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
