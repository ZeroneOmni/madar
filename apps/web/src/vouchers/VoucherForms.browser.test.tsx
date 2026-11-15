import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { VoucherInspector } from "./VoucherForms";

it("keeps an existing username hidden during editing until explicitly revealed", async () => {
  const previous = localStorage.getItem("madar:shell-settings");
  localStorage.setItem(
    "madar:shell-settings",
    JSON.stringify({ maskSensitive: true, workspaceMaskSensitive: null, onboardingComplete: true }),
  );
  using _settings = {
    [Symbol.dispose]() {
      if (previous === null) localStorage.removeItem("madar:shell-settings");
      else localStorage.setItem("madar:shell-settings", previous);
    },
  };
  await using screen = await render(
    <VoucherInspector
      row={{
        id: "*1",
        customer: "admin",
        username: "private-voucher",
        disabled: false,
        profile: "",
        sharedUsers: "1",
        comment: "",
        upload: "",
        download: "",
        uptime: "",
        lastSeen: "",
        activeSessions: "",
        observedAt: "2026-11-14T00:00:00Z",
      }}
      scope={{
        router: {
          id: "test",
          name: "Test",
          host: "127.0.0.1",
          port: 8729,
          transport: "tls",
          username: "admin",
          color: "blue",
          icon: "router",
          label: "",
        },
        customer: "admin",
      }}
      connected
      onReview={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  await screen.getByRole("button", { name: "Edit voucher", exact: true }).click();
  const username = screen.getByLabelText("Username", { exact: true });
  await expect.element(username).toHaveAttribute("type", "password");
  await screen.getByRole("button", { name: "Reveal username for editing", exact: true }).click();
  await expect.element(username).toHaveAttribute("type", "text");
  await expect.element(username).toHaveValue("private-voucher");
  await screen.getByRole("button", { name: "Hide username", exact: true }).click();
  await expect.element(username).toHaveAttribute("type", "password");
});
