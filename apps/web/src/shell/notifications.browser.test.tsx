import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import {
  NotificationCenter,
  NotificationSettings,
  NotificationsCoordinator,
} from "./notificationsUI";
import { notifyShell } from "./notifications";
import { SensitiveText } from "./SensitiveText";

function isolatedNotifications() {
  const history = localStorage.getItem("madar:shell-notifications");
  const preferences = localStorage.getItem("madar:notification-preferences");
  localStorage.removeItem("madar:shell-notifications");
  localStorage.setItem(
    "madar:notification-preferences",
    JSON.stringify({ inApp: false, desktop: false }),
  );
  return {
    [Symbol.dispose]() {
      for (const [key, value] of [
        ["madar:shell-notifications", history],
        ["madar:notification-preferences", preferences],
      ] as const) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    },
  };
}

it("retains real operation results across remount and supports read, unread and dismissal", async () => {
  using _state = isolatedNotifications();
  const navigate = vi.fn();
  await using first = await render(<NotificationCenter onNavigate={navigate} />);
  await expect.element(first.getByText("No notifications yet.", { exact: false })).toBeVisible();
  notifyShell({
    title: "Settings saved",
    message: "Privacy preferences updated",
    level: "success",
    path: "/settings/privacy",
  });
  await expect.element(first.getByRole("heading", { name: "Settings saved" })).toBeVisible();
  await first.getByRole("button", { name: "Mark read", exact: true }).click();
  expect(JSON.parse(localStorage.getItem("madar:shell-notifications") ?? "[]")[0].read).toBe(true);
  await first.unmount();
  await using second = await render(<NotificationCenter onNavigate={navigate} />);
  await second.getByRole("button", { name: "Mark unread" }).click();
  await second.getByRole("button", { name: "Open", exact: true }).click();
  expect(navigate).toHaveBeenCalledWith("/settings/privacy");
  await second.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect.element(second.getByText("No notifications yet.", { exact: false })).toBeVisible();
});

it("reports failed history writes without dropping an existing result and recovers", async () => {
  using _state = isolatedNotifications();
  notifyShell({ title: "Save failed", level: "error" });
  await using screen = await render(<NotificationCenter onNavigate={() => {}} />);
  using storage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Unavailable");
  });
  await screen.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Could not update notification history. Try again.");
  await expect.element(screen.getByRole("heading", { name: "Save failed" })).toBeVisible();
  storage.mockRestore();
  await screen.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

it("masks the actual value, reveals and hides it, and recovers after clipboard failure", async () => {
  await using screen = await render(
    <SensitiveText value="http://localhost:8077" label="Local app address" />,
  );
  await expect
    .element(screen.getByLabelText("Local app address hidden"))
    .toHaveTextContent("••••••••");
  await screen.getByRole("button", { name: "Reveal local app address" }).click();
  await expect
    .element(screen.getByLabelText("Local app address", { exact: true }))
    .toHaveTextContent("http://localhost:8077");
  await screen.getByRole("button", { name: "Hide local app address" }).click();
  using clipboard = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValueOnce(new Error("Denied"))
    .mockResolvedValue(undefined);
  await screen.getByRole("button", { name: "Copy local app address" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Could not copy local app address. Try again.");
  await screen.getByRole("button", { name: "Copy local app address" }).click();
  await expect.element(screen.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(clipboard).toHaveBeenLastCalledWith("http://localhost:8077");
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

it("keeps blocked desktop permission disabled, then enables and disables after permission recovers", async () => {
  using _state = isolatedNotifications();
  using _permission = vi.spyOn(Notification, "permission", "get").mockReturnValue("denied");
  await using screen = await render(<NotificationSettings />);
  using request = vi
    .spyOn(Notification, "requestPermission")
    .mockResolvedValueOnce("denied")
    .mockResolvedValue("granted");
  await screen.getByRole("button", { name: "Enable desktop notifications" }).click();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent(
      "Desktop notifications are unavailable or blocked. Allow Madar notifications in your operating system or browser settings, then try again.",
    );
  expect(JSON.parse(localStorage.getItem("madar:notification-preferences") ?? "{}").desktop).toBe(
    false,
  );
  await screen.getByRole("button", { name: "Enable desktop notifications" }).click();
  await expect
    .element(screen.getByRole("button", { name: "Disable desktop notifications" }))
    .toBeVisible();
  expect(JSON.parse(localStorage.getItem("madar:notification-preferences") ?? "{}").desktop).toBe(
    true,
  );
  await screen.getByRole("button", { name: "Disable desktop notifications" }).click();
  expect(JSON.parse(localStorage.getItem("madar:notification-preferences") ?? "{}").desktop).toBe(
    false,
  );
  expect(request).toHaveBeenCalledTimes(2);
});

it("records failed desktop delivery and retries without losing the in-app result", async () => {
  using _state = isolatedNotifications();
  using _globals = { [Symbol.dispose]: () => vi.unstubAllGlobals() };
  const delivery = vi
    .fn()
    .mockResolvedValueOnce({ status: "failed", message: "Operating system blocked delivery." })
    .mockResolvedValue({ status: "shown" });
  vi.stubGlobal("desktopBridge", { showNotification: delivery, onUpdateState: () => () => {} });
  localStorage.setItem(
    "madar:notification-preferences",
    JSON.stringify({ inApp: false, desktop: true }),
  );
  await using screen = await render(
    <>
      <NotificationsCoordinator onNavigate={() => {}} />
      <NotificationCenter onNavigate={() => {}} />
    </>,
  );
  notifyShell({ title: "Save failed", level: "error" });
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Operating system blocked delivery.");
  await screen.getByRole("button", { name: "Retry desktop delivery" }).click();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { name: "Save failed" })).toBeVisible();
  expect(delivery).toHaveBeenCalledTimes(2);
});
