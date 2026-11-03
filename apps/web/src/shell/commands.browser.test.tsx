import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { CommandMenu, useShellCommands } from "./commands";
import { ShortcutSettings } from "./shortcuts";
import "../index.css";

function isolatedShortcuts() {
  const key = "madar:shell-shortcuts";
  const old = window.localStorage.getItem(key);
  window.localStorage.removeItem(key);
  return {
    [Symbol.dispose]() {
      if (old === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, old);
      window.dispatchEvent(new Event("madar:shell-shortcuts-change"));
    },
  };
}
function Harness({ settings = false }: { settings?: boolean }) {
  const [path, setPath] = useState("/overview");
  const [collapsed, setCollapsed] = useState(false);
  const commands = useShellCommands({
    onNavigate: setPath,
    onToggleSidebar: () => setCollapsed((value) => !value),
  });
  return (
    <>
      <h1>{path}</h1>
      <p>{collapsed ? "Collapsed" : "Expanded"}</p>
      {settings ? <ShortcutSettings /> : null}
      <CommandMenu {...commands} />
    </>
  );
}
const primary = /Mac|iPhone|iPad/.test(navigator.platform) ? "Meta" : "Control";

it("filters the command palette, executes its highlighted result, and dismisses empty search", async () => {
  using _storage = isolatedShortcuts();
  await using screen = await render(<Harness />);
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  const search = page.getByRole("combobox", { name: "Search commands" });
  await userEvent.type(search, "usage");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("heading", { name: "/usage" })).toBeVisible();
  await expect
    .element(page.getByRole("dialog", { name: "Command palette" }))
    .not.toBeInTheDocument();
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  await userEvent.type(page.getByRole("combobox", { name: "Search commands" }), "no such action");
  await expect.element(page.getByRole("status")).toHaveTextContent("No matching commands.");
  await userEvent.keyboard("{Escape}");
  await expect
    .element(page.getByRole("dialog", { name: "Command palette" }))
    .not.toBeInTheDocument();
});

it("keeps the active shortcut after a save failure and activates the saved replacement", async () => {
  using _storage = isolatedShortcuts();
  await using screen = await render(<Harness settings />);
  const editor = screen.getByRole("form", { name: "Shortcut Open command palette" });
  const input = editor.getByRole("textbox", { name: "Open command palette" });
  await input.fill("Mod+Shift+P");
  using _failure = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable");
  });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(editor.getByRole("alert")).toHaveTextContent("Storage unavailable");
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  expect(JSON.parse(window.localStorage.getItem("madar:shell-shortcuts") ?? "{}").palette).toBe(
    "Mod+Shift+P",
  );
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  await expect
    .element(page.getByRole("dialog", { name: "Command palette" }))
    .not.toBeInTheDocument();
  await userEvent.keyboard(`{${primary}>}{Shift>}P{/Shift}{/${primary}}`);
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

it("falls back visibly from corrupt saved shortcuts and preserves typing while allowing palette access", async () => {
  using _storage = isolatedShortcuts();
  window.localStorage.setItem("madar:shell-shortcuts", "corrupt");
  await using screen = await render(<Harness settings />);
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "Saved shortcuts could not be read. Defaults are active; reset to repair them.",
    );
  const input = screen.getByRole("textbox", { name: "Toggle sidebar" });
  await input.click();
  await userEvent.keyboard(`{${primary}>}b{/${primary}}`);
  await expect.element(screen.getByText("Expanded", { exact: true })).toBeVisible();
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await screen.getByRole("button", { name: "Reset all shortcuts" }).click();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem("madar:shell-shortcuts") ?? "{}").sidebar).toBe(
    "Mod+B",
  );
  await screen.getByRole("heading").click();
  await userEvent.keyboard(`{${primary}>}b{/${primary}}`);
  await expect.element(screen.getByText("Collapsed", { exact: true })).toBeVisible();
});
