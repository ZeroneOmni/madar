import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { showBootError } from "./bootError";

it("shows recovery guidance when startup fails before React mounts", async () => {
  const shell = document.createElement("div");
  shell.id = "boot-shell";
  document.body.append(shell);
  using _error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    showBootError(new Error("Sign-in rejected"));
    await expect
      .element(
        page.getByText(
          "Reopen the app or try Reload. If you opened a pairing link, use a fresh pairing link.",
        ),
      )
      .toBeVisible();
    await expect.element(page.getByRole("button", { name: "Reload" })).toBeVisible();
  } finally {
    shell.remove();
  }
});
