import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { voucherClient } from "./client";
import { VoucherInspector } from "./VoucherForms";

it("keeps an existing username visible during editing despite legacy masking preferences", async () => {
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
  const voucher = {
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
  };
  using _details = vi.spyOn(voucherClient, "details").mockResolvedValue({
    voucher,
    password: "visible-password",
    sessions: [],
    sessionsAvailable: true,
  });
  await using screen = await render(
    <VoucherInspector
      row={voucher}
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
  await expect
    .element(screen.getByLabelText("Password", { exact: true }))
    .toHaveTextContent("visible-password");
  await screen.getByRole("button", { name: "Edit voucher", exact: true }).click();
  const username = screen.getByRole("textbox", { name: "Username", exact: true });
  await expect.element(username).toHaveAttribute("type", "text");
  await expect.element(username).toHaveValue("private-voucher");
  await expect
    .element(screen.getByRole("button", { name: /reveal|hide/i }))
    .not.toBeInTheDocument();
});
