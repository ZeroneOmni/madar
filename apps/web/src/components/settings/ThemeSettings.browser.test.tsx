import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../../test/render";
import { ThemeSettings } from "./ThemeSettings";
import { T3_CHAT_THEME } from "@madar/shared/themePalettes";
import { useTheme } from "../../hooks/useTheme";
import { themeColorToHex, getCustomThemes, subscribeToCustomThemes } from "../../themePalette";
import "../../index.css";

function Appearance() {
  useTheme();
  return <ThemeSettings />;
}

function setup() {
  const unsubscribe = subscribeToCustomThemes(() => {});
  const keys = ["madar:themes:v1", "madar:theme-halves:v1", "madar:theme-appearance-mode"];
  const saved = keys.map((key) => [key, localStorage.getItem(key)] as const);
  for (const key of keys) localStorage.removeItem(key);
  localStorage.setItem("madar:theme-appearance-mode", "light");
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  return {
    [Symbol.dispose]() {
      for (const [key, value] of saved) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
      unsubscribe();
    },
  };
}

it("offers duplication for editable palettes rather than CSS defaults", async () => {
  using _state = setup();
  await using screen = await render(<Appearance />);
  await expect
    .element(screen.getByRole("button", { name: "Duplicate T3 Code", exact: true }))
    .not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Duplicate T3 Chat", exact: true }).click();
  await page.getByRole("button", { name: "Save theme", exact: true }).click();
  const stored = getCustomThemes();
  expect(stored[0]!.label).toBe("T3 Chat copy");
  expect(themeColorToHex(stored[0]!.colors.canvas)).toBe(
    themeColorToHex(T3_CHAT_THEME.colors.canvas),
  );
});

it("accepts a complete six-digit hex color without rewriting the in-progress text", async () => {
  using _state = setup();
  await using screen = await render(<Appearance />);
  await screen.getByRole("button", { name: "Create theme", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Accent color hex value", exact: true });
  await field.fill("");
  await userEvent.type(field, "#123456");
  await expect.element(field).toHaveValue("#123456");
  await page.getByRole("button", { name: "Save theme", exact: true }).click();
  const stored = getCustomThemes();
  expect(themeColorToHex(stored[0]!.colors.accent)).toBe("#123456");
});

it("previews and saves editable primary button colors", async () => {
  using _state = setup();
  await using screen = await render(<Appearance />);
  await screen.getByRole("button", { name: "Create theme", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Primary button hex value", exact: true })
    .fill("#2468ab");
  await vi.waitFor(() =>
    expect(
      themeColorToHex(getComputedStyle(document.documentElement).getPropertyValue("--primary")),
    ).toBe("#2468ab"),
  );
  await page.getByRole("button", { name: "Save theme", exact: true }).click();
  const stored = getCustomThemes();
  expect(themeColorToHex(stored[0]!.colors.messageAction)).toBe("#2468ab");
});
