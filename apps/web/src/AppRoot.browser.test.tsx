import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../test/render";
import { AppRoot } from "./AppRoot";
import "./index.css";

it("opens Settings, applies appearance, and returns to the greeting", async () => {
  await using screen = await render(<AppRoot />);
  await expect.element(screen.getByRole("heading", { name: "Hello world" })).toBeVisible();
  await screen.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect.element(settings).toBeVisible();
  await settings.getByRole("button", { name: "Dark", exact: true }).click();
  await expect
    .element(settings.getByRole("button", { name: "Dark", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await settings.getByRole("button", { name: "Done" }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await userEvent.keyboard("{Control>},{/Control}");
  await expect.element(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Dark", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading", { name: "Hello world" })).toBeVisible();
});

it("shows a failed appearance save and recovers when storage works again", async () => {
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Settings", exact: true }).click();
  using _storage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable");
  });
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("Could not save your appearance. Please try again.");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await page.getByRole("button", { name: "System", exact: true }).click();
});
