import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { SettingsPage } from "./settings";
import { WelcomePage } from "./WelcomePage";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, readSettings } from "./settingsState";
import "../index.css";

function setup() {
  const keys = [
    SETTINGS_STORAGE_KEY,
    "madar:shell-notifications",
    "madar:notification-preferences",
  ];
  const previous = keys.map((key) => [key, localStorage.getItem(key)] as const);
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
  localStorage.removeItem("madar:shell-notifications");
  localStorage.setItem(
    "madar:notification-preferences",
    JSON.stringify({ inApp: false, desktop: false }),
  );
  return {
    [Symbol.dispose]: () => {
      for (const [key, value] of previous) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    },
  };
}
function SettingsHarness() {
  const [path, setPath] = useState("/settings/general");
  return <SettingsPage path={path} onNavigate={setPath} />;
}

it("finds a setting, navigates to it, and focuses the deep-link target", async () => {
  using _state = setup();
  await using screen = await render(<SettingsHarness />);
  await screen.getByRole("searchbox", { name: "Search settings" }).fill("unavailable setting name");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("No settings found. Try another search.");
  await screen.getByRole("searchbox", { name: "Search settings" }).fill("inherited privacy");
  await screen.getByRole("button", { name: "Mask sensitive text" }).click();
  await expect.element(screen.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Mask sensitive text" })).toHaveFocus();
});

it("shows the effective source and resets a saved workspace override to the application default", async () => {
  using _state = setup();
  await using screen = await render(
    <SettingsPage path="/settings/privacy" onNavigate={() => {}} />,
  );
  await screen.getByRole("switch", { name: "Hide sensitive values by default" }).click();
  expect(readSettings().settings.workspaceMaskSensitive).toBe(false);
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Effective value: Visible. Source: Workspace override.");
  await screen.getByRole("button", { name: "Application defaults", exact: true }).click();
  await screen.getByRole("switch", { name: "Hide sensitive values by default" }).click();
  expect(readSettings().settings.maskSensitive).toBe(false);
  await screen.getByRole("button", { name: "This workspace" }).click();
  await screen.getByRole("button", { name: "Use application default" }).click();
  expect(readSettings().settings.workspaceMaskSensitive).toBeNull();
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("Effective value: Visible. Source: Application default.");
  await expect.element(screen.getByRole("switch")).not.toBeChecked();
});

it("keeps onboarding open when completion cannot be saved and completes on retry", async () => {
  using _state = setup();
  function WelcomeHarness() {
    const [done, setDone] = useState(false);
    return done ? <h1>Workspace ready</h1> : <WelcomePage onContinue={() => setDone(true)} />;
  }
  await using screen = await render(<WelcomeHarness />);
  using _write = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("storage denied");
  });
  await screen.getByRole("button", { name: "Open workspace" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Could not save setup completion. Check local storage access and try again.",
    );
  expect(readSettings().settings.onboardingComplete).toBe(false);
  await screen.getByRole("button", { name: "Try again" }).click();
  await expect.element(screen.getByRole("heading", { name: "Workspace ready" })).toBeVisible();
  expect(readSettings().settings.onboardingComplete).toBe(true);
});
