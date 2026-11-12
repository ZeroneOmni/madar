import { expect, it, vi } from "vite-plus/test";
import { initializeAppSession, probeRouter } from "./access";

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
