import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";
import { render, fakeTimers } from "../../test/render";
import { RouterConnections, RouterProvider } from "./RouterConnections";
import { RouterDiscoveryProvider } from "./discoveryState";
import { RouterDiscovery } from "./RouterDiscovery";
import { LOCALE_KEY } from "../locale";
import { CATALOG_KEY } from "./catalog";
import "../index.css";

const found = {
  kind: "complete",
  routers: [
    {
      identity: "Office",
      host: "192.168.88.1",
      mac: "10:2a:3b:4c:5d:6e",
      board: "hAP",
      version: "6.49.18",
    },
  ],
};

function responseGate() {
  let resolve: (response: Response) => void = () => {};
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function english() {
  const previous = localStorage.getItem(LOCALE_KEY);
  localStorage.setItem(LOCALE_KEY, "en");
  return {
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem(LOCALE_KEY);
      else localStorage.setItem(LOCALE_KEY, previous);
    },
  };
}

function isolatedCatalog() {
  const previous = localStorage.getItem(CATALOG_KEY);
  localStorage.removeItem(CATALOG_KEY);
  return {
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem(CATALOG_KEY);
      else localStorage.setItem(CATALOG_KEY, previous);
    },
  };
}
function Navigation() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(!open)}>Toggle connections</button>
      {open && <RouterConnections />}
    </>
  );
}

it("discovers at startup and keeps results when opening Connections; selection fills the address and focuses username", async () => {
  using _locale = english();
  const response = responseGate();
  using request = vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
  await using screen = await render(
    <RouterProvider>
      <Navigation />
    </RouterProvider>,
  );
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  response.resolve(Response.json(found));
  await userEvent.click(screen.getByRole("button", { name: "Toggle connections" }));
  const router = screen.getByRole("button", { name: /Office/ });
  await expect.element(router).toBeVisible();
  await expect.element(screen.getByText("10:2A:3B:4C:5D:6E", { exact: true })).toBeVisible();
  await expect.element(screen.getByRole("searchbox")).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /router details/ }))
    .not.toBeInTheDocument();
  await userEvent.click(router);
  await expect
    .element(screen.getByRole("textbox", { name: "Hostname or IP address" }))
    .toHaveValue("192.168.88.1");
  await expect
    .element(screen.getByRole("textbox", { name: "Router account username" }))
    .toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Toggle connections" }));
  await userEvent.click(screen.getByRole("button", { name: "Toggle connections" }));
  await expect.element(screen.getByRole("button", { name: /Office/ })).toBeVisible();
  expect(request).toHaveBeenCalledOnce();
  await expect
    .element(screen.getByRole("button", { name: /Search|Find routers/ }))
    .not.toBeInTheDocument();
});

it("refreshes cached neighbors without overlapping requests and retains results during failures", async () => {
  using _locale = english();
  const initial = responseGate();
  const refresh = responseGate();
  using request = vi
    .spyOn(globalThis, "fetch")
    .mockReturnValueOnce(initial.promise)
    .mockReturnValueOnce(refresh.promise)
    .mockResolvedValue(Response.json(found));
  await using screen = await render(
    <RouterDiscoveryProvider>
      <RouterDiscovery savedHosts={[]} selectedHost="" onSelect={() => {}} />
    </RouterDiscoveryProvider>,
  );
  using _timers = fakeTimers();
  initial.resolve(Response.json(found));
  await expect.element(screen.getByRole("button", { name: /Office/ })).toBeVisible();
  await vi.advanceTimersByTimeAsync(4999);
  expect(request).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  await expect.element(screen.getByRole("button", { name: /Office/ })).toBeVisible();
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledTimes(2);
  refresh.resolve(new Response("", { status: 503 }));
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /Office/ })).toBeVisible();
  await vi.advanceTimersByTimeAsync(5000);
  expect(request).toHaveBeenCalledTimes(3);
});

it("shows MAC-only neighbors and guides selection to an IP address instead of credentials", async () => {
  using _locale = english();
  using request = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({
      kind: "complete",
      routers: [{ ...found.routers[0], host: null }],
    }),
  );
  await using screen = await render(
    <RouterProvider>
      <RouterConnections />
    </RouterProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: /Office.*IP address needed/ }));
  await expect
    .element(screen.getByRole("textbox", { name: "Hostname or IP address" }))
    .toHaveValue("");
  await expect
    .element(screen.getByRole("textbox", { name: "Hostname or IP address" }))
    .toHaveFocus();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "This router has no IP address. Configure an IP address on the router, then enter it here. Madar connects over IP, not MAC.",
    );
  expect(request).toHaveBeenCalledOnce();
});

it("waits while hidden and discovers on a local network even without internet connectivity", async () => {
  using _locale = english();
  using visibility = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  using _online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  using request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(found));
  await using screen = await render(
    <RouterDiscoveryProvider>
      <RouterDiscovery savedHosts={[]} selectedHost="" onSelect={() => {}} />
    </RouterDiscoveryProvider>,
  );
  expect(request).not.toHaveBeenCalled();
  visibility.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.element(screen.getByRole("button", { name: /Office/ })).toBeVisible();
  expect(request).toHaveBeenCalledOnce();
});

it("hides a router as soon as it is saved and shows it again after removal without another scan", async () => {
  using _locale = english();
  using _catalog = isolatedCatalog();
  using request = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      Response.json(
        String(url).endsWith("/discover")
          ? found
          : String(url).endsWith("/disconnect")
            ? { disconnected: true }
            : { kind: "failed", reason: "authentication" },
      ),
    );
  await using screen = await render(
    <RouterProvider>
      <RouterConnections />
    </RouterProvider>,
  );
  const neighbor = screen.getByRole("button", { name: /Office.*192\.168\.88\.1/ });
  await expect.element(neighbor).toBeVisible();
  await userEvent.click(neighbor);
  await userEvent.type(screen.getByRole("textbox", { name: "Router account username" }), "admin");
  await userEvent.click(screen.getByRole("button", { name: "Save and connect" }));
  await expect.element(screen.getByRole("heading", { name: "Saved connections" })).toBeVisible();
  await expect.element(neighbor).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Remove", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
  await expect.element(neighbor).toBeVisible();
  expect(request.mock.calls.filter(([url]) => String(url).endsWith("/discover"))).toHaveLength(1);
});

it("excludes every saved host on startup while retaining other routers with the same identity and MAC-only neighbors", async () => {
  using _locale = english();
  using _catalog = isolatedCatalog();
  localStorage.setItem(
    CATALOG_KEY,
    JSON.stringify({
      selected: null,
      routers: ["192.168.88.1", "192.168.88.2"].map((host) => ({
        id: host,
        name: "Saved router",
        host,
        port: 8729,
        username: "admin",
        transport: "tls",
        color: "blue",
        icon: "router",
        label: "",
      })),
    }),
  );
  using _request = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    Response.json({
      kind: "complete",
      routers: ["192.168.88.1", "192.168.88.2", "192.168.88.3", null].map((host) => ({
        ...found.routers[0],
        host,
      })),
    }),
  );
  await using screen = await render(
    <RouterProvider>
      <RouterConnections />
    </RouterProvider>,
  );
  await expect
    .element(screen.getByRole("button", { name: /Office.*192\.168\.88\.3/ }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: /Office.*192\.168\.88\.1/ }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /Office.*192\.168\.88\.2/ }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: /Office.*IP address needed/ }))
    .toBeVisible();
});
