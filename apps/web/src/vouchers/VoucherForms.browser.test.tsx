import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { voucherClient } from "./client";
import { VoucherInspector } from "./VoucherForms";
import { voucherRow } from "../../test/voucherRow";

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
  const voucher = voucherRow({ username: "private-voucher" });
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

it("saves a typed local field from the details panel without a router connection", async () => {
  using setValues = vi.spyOn(voucherClient, "setFieldValues").mockResolvedValue({ updated: 1 });
  const onSaved = vi.fn();
  await using screen = await render(
    <VoucherInspector
      row={voucherRow({ fields: { "2": "North" } })}
      scope={{
        router: {
          id: "test",
          name: "Test",
          host: "127.0.0.1",
          port: 8728,
          transport: "tcp",
          username: "admin",
          color: "blue",
          icon: "router",
          label: "",
        },
        customer: "admin",
      }}
      connected={false}
      onReview={vi.fn()}
      onClose={vi.fn()}
      fields={[
        { id: 1, name: "Paid", type: "number", choices: [], valueCount: 0 },
        { id: 2, name: "Shop", type: "text", choices: [], valueCount: 1 },
      ]}
      onFieldsSaved={onSaved}
    />,
  );
  await expect
    .element(screen.getByText("Saved on this PC only. Never sent to the router."))
    .toBeVisible();
  await expect.element(screen.getByRole("textbox", { name: "Shop" })).toHaveValue("North");
  const save = screen.getByRole("button", { name: "Save my fields" });
  await expect.element(save).toBeDisabled();
  await screen.getByRole("spinbutton", { name: "Paid" }).fill("12.5");
  await save.click();
  await expect.element(screen.getByText("Saved on this PC.")).toBeVisible();
  expect(setValues).toHaveBeenCalledWith(
    expect.objectContaining({ ids: ["*1"], values: [{ fieldId: 1, value: 12.5 }] }),
  );
  expect(onSaved).toHaveBeenCalledOnce();
  await expect.element(save).toBeDisabled();
});

it("does not report a local field as saved when the voucher is gone", async () => {
  using _setValues = vi.spyOn(voucherClient, "setFieldValues").mockResolvedValue({ updated: 0 });
  const onSaved = vi.fn();
  await using screen = await render(
    <VoucherInspector
      row={voucherRow()}
      scope={{
        router: {
          id: "test",
          name: "Test",
          host: "127.0.0.1",
          port: 8728,
          transport: "tcp",
          username: "admin",
          color: "blue",
          icon: "router",
          label: "",
        },
        customer: "admin",
      }}
      connected={false}
      onReview={vi.fn()}
      onClose={vi.fn()}
      fields={[{ id: 2, name: "Shop", type: "text", choices: [], valueCount: 0 }]}
      onFieldsSaved={onSaved}
    />,
  );
  await screen.getByRole("textbox", { name: "Shop" }).fill("North");
  await screen.getByRole("button", { name: "Save my fields" }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent(
      "This voucher is no longer saved on this PC. Refresh vouchers and try again.",
    );
  expect(onSaved).not.toHaveBeenCalled();
});
