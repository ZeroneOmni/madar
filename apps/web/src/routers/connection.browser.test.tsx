import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import type { RouterCredentialRequest, RouterProfile } from "@madar/contracts";
import { render, fakeTimers } from "../../test/render";
import { RouterConnections, RouterProvider } from "./RouterConnections";
import { CATALOG_KEY } from "./catalog";
import "../index.css";

const profile: RouterProfile = {
  id: "office",
  name: "Office",
  host: "router.local",
  port: 8728,
  username: "admin",
  transport: "tcp",
  color: "blue",
  icon: "router",
  label: "",
};
const connected = {
  kind: "connected",
  service: "router-api",
  identity: "Office",
  version: "6.49.18",
};
function setup(autoConnect = true) {
  const previous = localStorage.getItem(CATALOG_KEY);
  localStorage.setItem(
    CATALOG_KEY,
    JSON.stringify({ routers: [profile], selected: profile.id, autoConnect }),
  );
  const passwords = new Map([[profile.id, "fixture-password"]]);
  const credentials = vi.fn(async (request: RouterCredentialRequest) => {
    if (request.kind === "get") return passwords.get(request.profile.id) ?? null;
    if (request.kind === "set") passwords.set(request.profile.id, request.password);
    else passwords.delete(request.profileId);
    return null;
  });
  vi.stubGlobal("desktopBridge", {
    routerCredentials: credentials,
    getLocalEnvironmentBootstraps: () => [],
    getLocalEnvironmentBearerToken: async () => "fixture-token",
  });
  return {
    credentials,
    passwords,
    [Symbol.dispose]() {
      vi.unstubAllGlobals();
      if (previous === null) localStorage.removeItem(CATALOG_KEY);
      else localStorage.setItem(CATALOG_KEY, previous);
    },
  };
}
function jsonResponse(value: unknown) {
  return Object.assign(Response.json(value), { json: async () => value });
}
function reply(url: URL | RequestInfo) {
  return jsonResponse(
    String(url).endsWith("/discover")
      ? { kind: "complete", routers: [] }
      : String(url).endsWith("/disconnect")
        ? { disconnected: true }
        : connected,
  );
}
function Connection() {
  return (
    <RouterProvider>
      <RouterConnections />
    </RouterProvider>
  );
}

function responseGate() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

it("resumes with the saved password, remembers Disconnect across reopening, and reconnects only on Connect", async () => {
  using fixture = setup();
  using request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => reply(url));
  await using screen = await render(<Connection />);
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  expect(request.mock.calls.find(([url]) => String(url).endsWith("/probe"))?.[1]?.body).toBe(
    JSON.stringify({ profile, password: "fixture-password" }),
  );
  expect(localStorage.getItem(CATALOG_KEY)).not.toContain("fixture-password");
  await userEvent.click(screen.getByRole("button", { name: "Disconnect", exact: true }));
  await expect.element(screen.getByRole("button", { name: "Connect", exact: true })).toBeEnabled();
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).autoConnect).toBe(false);
  await screen.unmount();
  request.mockClear();
  await using reopened = await render(<Connection />);
  await expect.element(reopened.getByText("Saved password will be used.")).toBeVisible();
  await expect
    .element(reopened.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Disconnected");
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/probe"))).toHaveLength(0);
  await userEvent.click(reopened.getByRole("button", { name: "Connect", exact: true }));
  await expect
    .element(reopened.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).autoConnect).toBe(true);
  expect(fixture.passwords.get(profile.id)).toBe("fixture-password");
});

it("opens offline, retries with saved credentials, and recovers without user action", async () => {
  using _fixture = setup();
  let reachable = false;
  const initial = responseGate();
  let probes = 0;
  using request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (!String(url).endsWith("/probe")) return reply(url);
    if (++probes === 1) return initial.promise;
    return reachable ? reply(url) : jsonResponse({ kind: "failed", reason: "network" });
  });
  await using screen = await render(<Connection />);
  using _timers = fakeTimers();
  initial.resolve(jsonResponse({ kind: "failed", reason: "network" }));
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Reconnecting");
  await vi.advanceTimersByTimeAsync(300000);
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/probe"))).toHaveLength(11);
  reachable = true;
  await vi.advanceTimersByTimeAsync(30000);
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
});

it("recreates the router session after the local backend loses its session", async () => {
  using _fixture = setup();
  const initial = responseGate();
  let probes = 0;
  using request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).endsWith("/probe") && ++probes === 1) return initial.promise;
    return String(url).endsWith("/status")
      ? jsonResponse({ kind: "failed", reason: "authentication" })
      : reply(url);
  });
  await using screen = await render(<Connection />);
  using _timers = fakeTimers();
  initial.resolve(jsonResponse(connected));
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  await vi.advanceTimersByTimeAsync(30000);
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/probe"))).toHaveLength(2);
});

it("Disconnect wins over a pending startup credential read", async () => {
  using fixture = setup();
  let complete: (value: string) => void = () => {};
  const password = new Promise<string>((resolve) => {
    complete = resolve;
  });
  fixture.credentials.mockReturnValue(password);
  using request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => reply(url));
  await using screen = await render(<Connection />);
  await userEvent.click(screen.getByRole("button", { name: "Disconnect", exact: true }));
  complete("fixture-password");
  await password;
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Disconnected");
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/probe"))).toHaveLength(0);
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).autoConnect).toBe(false);
});

it("replacing a rejected password saves it and enables reconnection after reopening", async () => {
  using fixture = setup();
  using request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, init) =>
      String(url).endsWith("/probe") &&
      JSON.parse(String(init?.body)).password !== "updated-password"
        ? jsonResponse({ kind: "failed", reason: "authentication" })
        : reply(url),
    );
  await using screen = await render(<Connection />);
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Needs attention");
  await userEvent.type(
    screen.getByRole("textbox", { name: "Router account password" }).first(),
    "updated-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Connect", exact: true }));
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  expect(fixture.passwords.get(profile.id)).toBe("updated-password");
  await screen.unmount();
  await using reopened = await render(<Connection />);
  await expect
    .element(reopened.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/probe"))).toHaveLength(3);
});

it("removing a router also removes its stored password", async () => {
  using fixture = setup(false);
  using _request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => reply(url));
  await using screen = await render(<Connection />);
  await userEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await expect
    .element(screen.getByRole("heading", { name: "Saved connections" }))
    .not.toBeInTheDocument();
  expect(fixture.passwords.has(profile.id)).toBe(false);
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).selected).toBeNull();
});

it("keeps a session connected when saving the password fails without promising startup reconnection", async () => {
  using fixture = setup(false);
  fixture.passwords.clear();
  fixture.credentials.mockImplementation(async (request) => {
    if (request.kind === "set") throw new Error("Fixture storage unavailable");
    return null;
  });
  using _request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => reply(url));
  await using screen = await render(<Connection />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Router account password" }).first(),
    "session-password",
  );
  await userEvent.click(screen.getByRole("button", { name: "Connect", exact: true }));
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Your password could not be saved on this device. Reopening will require your password.",
    );
  await expect
    .element(screen.getByText("Connected for this session. Reopening will require your password."))
    .toBeVisible();
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).autoConnect).toBe(false);
  expect(localStorage.getItem(CATALOG_KEY)).not.toContain("session-password");
});

it("editing a saved router loads its password instead of replacing it with a blank one", async () => {
  using _fixture = setup(false);
  using _request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => reply(url));
  await using screen = await render(<Connection />);
  await userEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
  await expect
    .element(screen.getByRole("textbox", { name: "Router account password" }).last())
    .toHaveValue("fixture-password");
  await userEvent.click(screen.getByRole("button", { name: "Save and connect" }));
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
});

it("waits for a saved password before allowing an edited router to be saved", async () => {
  using fixture = setup(false);
  using _request = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => reply(url));
  await using screen = await render(<Connection />);
  await expect.element(screen.getByText("Saved password will be used.")).toBeVisible();
  const password = Promise.withResolvers<string | null>();
  fixture.credentials.mockReturnValueOnce(password.promise);
  await userEvent.click(screen.getByRole("button", { name: "Edit", exact: true }));
  await expect.element(screen.getByRole("button", { name: "Save and connect" })).toBeDisabled();
  password.resolve("fixture-password");
  await expect
    .element(screen.getByRole("textbox", { name: "Router account password" }).last())
    .toHaveValue("fixture-password");
  await expect.element(screen.getByRole("button", { name: "Save and connect" })).toBeEnabled();
});

it("keeps the router and password available when closing its session fails during removal", async () => {
  using fixture = setup();
  let closeFails = true;
  using _request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      String(url).endsWith("/disconnect") && closeFails
        ? jsonResponse({ disconnected: false })
        : reply(url),
    );
  await using screen = await render(<Connection />);
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  await userEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await expect.element(screen.getByRole("button", { name: "Retry disconnect" })).toBeVisible();
  expect(fixture.passwords.get(profile.id)).toBe("fixture-password");
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).selected).toBe(profile.id);
  closeFails = false;
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await expect
    .element(screen.getByRole("heading", { name: "Saved connections" }))
    .not.toBeInTheDocument();
  expect(fixture.passwords.has(profile.id)).toBe(false);
});

it("keeps the current router selected when closing its session fails during switching", async () => {
  using _fixture = setup();
  localStorage.setItem(
    CATALOG_KEY,
    JSON.stringify({
      routers: [profile, { ...profile, id: "second", name: "Second" }],
      selected: profile.id,
      autoConnect: true,
    }),
  );
  using _request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      String(url).endsWith("/disconnect") ? jsonResponse({ disconnected: false }) : reply(url),
    );
  await using screen = await render(<Connection />);
  await expect
    .element(screen.getByRole("status", { name: "Router connection status" }))
    .toHaveTextContent("Connected");
  await userEvent.click(screen.getByRole("button", { name: "Select", exact: true }));
  await expect.element(screen.getByRole("button", { name: "Retry disconnect" })).toBeEnabled();
  expect(JSON.parse(localStorage.getItem(CATALOG_KEY)!).selected).toBe(profile.id);
});
