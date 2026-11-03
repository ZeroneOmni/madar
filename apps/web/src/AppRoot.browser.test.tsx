import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../test/render";
import { AppRoot } from "./AppRoot";
import "./index.css";

function setup(path = "/") {
  const saved = new Map<string, string>();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("madar:")) {
      saved.set(key, localStorage.getItem(key)!);
      localStorage.removeItem(key);
    }
  }
  const previousUrl = location.href;
  history.replaceState(null, "", "#" + path);
  return {
    [Symbol.dispose]() {
      for (const key of Object.keys(localStorage))
        if (key.startsWith("madar:")) localStorage.removeItem(key);
      for (const [key, value] of saved) localStorage.setItem(key, value);
      history.replaceState(null, "", previousUrl);
    },
  };
}

it("completes welcome, searches Settings, preserves appearance and returns through breadcrumbs", async () => {
  await page.viewport(1280, 900);
  using _state = setup();
  await using screen = await render(<AppRoot />);
  await expect.element(screen.getByRole("heading", { name: "Welcome to Madar" })).toBeVisible();
  await screen.getByRole("button", { name: "Open workspace", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Your User Manager workspace" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Open Settings", exact: true }).click();
  await screen.getByRole("searchbox", { name: "Search settings" }).fill("theme");
  await screen.getByRole("button", { name: "Appearance", exact: true }).click();
  await screen.getByRole("button", { name: "Dark", exact: true }).click();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await screen.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Your User Manager workspace" }))
    .toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect
    .element(restarted.getByRole("heading", { name: "Your User Manager workspace" }))
    .toBeVisible();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("persists groups and pinning, then removes the group without losing destinations", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/overview");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Organize navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Organize navigation" });
  await dialog.getByRole("textbox", { name: "New group name" }).fill("Daily");
  await dialog.getByRole("button", { name: "Add group", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Group for Usage" }).click();
  await page.getByRole("option", { name: "Daily", exact: true }).click();
  await dialog.getByRole("button", { name: "Pin Vouchers", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Daily", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Vouchers - Pinned", exact: true }))
    .toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect.element(restarted.getByRole("button", { name: "Daily", exact: true })).toBeVisible();
  await restarted.getByRole("button", { name: "Organize navigation" }).click();
  await page.getByRole("button", { name: "Unpin Vouchers", exact: true }).click();
  await page.getByRole("button", { name: "Remove Daily", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .element(restarted.getByRole("button", { name: "Daily", exact: true }))
    .not.toBeInTheDocument();
  await restarted.getByRole("button", { name: "Usage", exact: true }).click();
  await expect
    .element(restarted.getByRole("heading", { name: "Usage", exact: true }))
    .toBeVisible();
  await expect
    .element(restarted.getByRole("heading", { name: "User Manager is not connected" }))
    .toBeVisible();
});

it("retains navigation after a failed write and recovers on retry", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/overview");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Organize navigation" }).click();
  using _storage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable");
  });
  await page.getByRole("button", { name: "Pin Usage", exact: true }).click();
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toHaveTextContent(
      "Could not save navigation. Your previous layout is still in use. Please try again.",
    );
  await expect
    .element(page.getByRole("button", { name: "Pin Usage", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pin Usage", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Unpin Usage", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await userEvent.keyboard("{Control>}k{/Control}");
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});
