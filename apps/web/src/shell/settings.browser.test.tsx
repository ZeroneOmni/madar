import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { SidebarProvider } from "../components/ui/sidebar";
import { ShellSidebar } from "./ShellSidebar";
import { defaultNavigation } from "./navigation";
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
  return (
    <SidebarProvider>
      <ShellSidebar
        state={defaultNavigation}
        path={path}
        onNavigate={setPath}
        onCommand={() => {}}
        onChange={() => true}
        error={null}
      />
      <SettingsPage path={path} onNavigate={setPath} />
    </SidebarProvider>
  );
}

it("finds a setting, navigates to it, and focuses the deep-link target", async () => {
  await page.viewport(1280, 900);
  using _state = setup();
  await using screen = await render(<SettingsHarness />);
  await screen.getByRole("searchbox", { name: "Search settings" }).fill("unavailable setting name");
  await expect
    .element(screen.getByRole("status"))
    .toHaveTextContent("No settings found. Try another search.");
  await screen.getByRole("searchbox", { name: "Search settings" }).fill("first run setup");
  await screen.getByRole("button", { name: "Welcome and onboarding" }).click();
  await expect.element(screen.getByRole("heading", { name: "General", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Welcome and onboarding" }))
    .toHaveFocus();
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
