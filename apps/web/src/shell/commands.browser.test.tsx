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
  await editor.getByRole("button", { name: "Edit shortcut for Open command palette" }).click();
  const input = editor.getByRole("textbox", { name: "Open command palette" });
  await input.fill("Mod+Shift+P");
  using _failure = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable");
  });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(editor.getByRole("alert")).toHaveTextContent("Storage unavailable");
  await screen.getByRole("heading", { name: "/overview" }).click();
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
  const input = screen.getByRole("searchbox", { name: "Search keybindings" });
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
  await screen.getByRole("heading", { name: "/overview" }).click();
  await userEvent.keyboard(`{${primary}>}b{/${primary}}`);
  await expect.element(screen.getByText("Collapsed", { exact: true })).toBeVisible();
});

it("records without executing commands, rejects conflicts, and restores a removed binding", async () => {
  using _storage = isolatedShortcuts();
  await using screen = await render(<Harness settings />);
  const editor = screen.getByRole("form", { name: "Shortcut Toggle sidebar" });
  await editor.getByRole("button", { name: "Edit shortcut for Toggle sidebar" }).click();
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  await expect
    .element(page.getByRole("dialog", { name: "Command palette" }))
    .not.toBeInTheDocument();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .element(editor.getByRole("alert"))
    .toHaveTextContent("That shortcut is already assigned to another command.");
  expect(window.localStorage.getItem("madar:shell-shortcuts")).toBeNull();
  await editor.getByRole("textbox").click();
  await userEvent.keyboard(`{${primary}>}{Shift>}b{/Shift}{/${primary}}`);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await screen.rerender(<Harness settings />);
  await screen.getByRole("heading", { name: "/overview" }).click();
  await userEvent.keyboard(`{${primary}>}b{/${primary}}`);
  await expect.element(screen.getByText("Expanded", { exact: true })).toBeVisible();
  await userEvent.keyboard(`{${primary}>}{Shift>}b{/Shift}{/${primary}}`);
  await expect.element(screen.getByText("Collapsed", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Actions for Toggle sidebar" }).click();
  await page.getByRole("menuitem", { name: "Remove", exact: true }).click();
  await expect
    .element(editor.getByRole("button", { name: "Edit shortcut for Toggle sidebar" }))
    .toHaveTextContent("Unassigned");
  await screen.getByRole("heading", { name: "/overview" }).click();
  await userEvent.keyboard(`{${primary}>}{Shift>}b{/Shift}{/${primary}}`);
  await expect.element(screen.getByText("Collapsed", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Actions for Toggle sidebar" }).click();
  await page.getByRole("menuitem", { name: "Reset to default" }).click();
  await screen.getByRole("heading", { name: "/overview" }).click();
  await userEvent.keyboard(`{${primary}>}b{/${primary}}`);
  await expect.element(screen.getByText("Expanded", { exact: true })).toBeVisible();
});

it("adds a binding, filters the list, and validates JSON edits before applying them", async () => {
  using _storage = isolatedShortcuts();
  await using screen = await render(<Harness settings />);
  await screen.getByRole("button", { name: "Add keybinding", exact: true }).click();
  const editor = screen.getByRole("form", { name: "Shortcut Go to vouchers" });
  await userEvent.keyboard(`{${primary}>}{Shift>}j{/Shift}{/${primary}}`);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await screen.getByRole("heading", { name: "/overview" }).click();
  await userEvent.keyboard(`{${primary}>}{Shift>}j{/Shift}{/${primary}}`);
  await expect.element(screen.getByRole("heading", { name: "/vouchers" })).toBeVisible();
  const search = screen.getByRole("searchbox", { name: "Search keybindings" });
  await search.fill("vouchers");
  await expect.element(editor).toBeVisible();
  await expect
    .element(screen.getByRole("form", { name: "Shortcut Toggle sidebar" }))
    .not.toBeInTheDocument();
  await search.fill("no matching shortcut");
  await expect.element(screen.getByText("No keybindings match your search.")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(screen.getByRole("form", { name: "Shortcut Toggle sidebar" })).toBeVisible();
  await screen.getByRole("button", { name: "Edit keybindings JSON" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit keybindings JSON" });
  const json = dialog.getByRole("textbox", { name: "Keybindings JSON" });
  const original = window.localStorage.getItem("madar:shell-shortcuts");
  await json.fill("invalid");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(dialog.getByRole("alert")).toHaveTextContent("Enter valid JSON.");
  expect(window.localStorage.getItem("madar:shell-shortcuts")).toBe(original);
  await json.fill(JSON.stringify({ ...JSON.parse(original ?? "{}"), vouchers: "Mod+Shift+U" }));
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await screen.getByRole("heading", { name: "/vouchers" }).click();
  await userEvent.keyboard(`{${primary}>}k{/${primary}}`);
  await userEvent.type(page.getByRole("combobox", { name: "Search commands" }), "overview");
  await userEvent.keyboard("{Enter}");
  await expect.element(screen.getByRole("heading", { name: "/overview" })).toBeVisible();
  await screen.getByRole("heading", { name: "/overview" }).click();
  await userEvent.keyboard(`{${primary}>}{Shift>}u{/Shift}{/${primary}}`);
  await expect.element(screen.getByRole("heading", { name: "/vouchers" })).toBeVisible();
  expect(JSON.parse(window.localStorage.getItem("madar:shell-shortcuts") ?? "{}").vouchers).toBe(
    "Mod+Shift+U",
  );
});
