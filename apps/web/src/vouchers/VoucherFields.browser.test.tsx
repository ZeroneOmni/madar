import "../index.css";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../../test/render";
import { BulkFieldDialog } from "./VoucherFields";

it("blocks a bulk clear while a number is unfinished, until the field changes", async () => {
  const onApply = vi.fn().mockResolvedValue("");
  await using _screen = await render(
    <BulkFieldDialog
      open
      count={2}
      fields={[
        { id: 1, name: "Paid", type: "number", choices: [], valueCount: 0 },
        { id: 2, name: "Shop", type: "text", choices: [], valueCount: 0 },
      ]}
      onOpenChange={vi.fn()}
      onApply={onApply}
    />,
  );
  const dialog = page.getByRole("dialog");
  const clear = dialog.getByRole("button", { name: "Clear for 2 vouchers" });
  await expect.element(clear).toBeEnabled();
  // An unfinished number keeps the input's value empty; only its validity shows the problem.
  await userEvent.type(dialog.getByRole("spinbutton", { name: "Value" }), "e");
  await expect.element(clear).toBeDisabled();
  await dialog.getByRole("combobox", { name: "Field" }).click();
  await page.getByRole("option", { name: "Shop" }).click();
  await expect.element(clear).toBeEnabled();
  expect(onApply).not.toHaveBeenCalled();
});

it("keeps an exponent typed through an unfinished number", async () => {
  const onApply = vi.fn().mockResolvedValue("");
  await using _screen = await render(
    <BulkFieldDialog
      open
      count={2}
      fields={[{ id: 1, name: "Paid", type: "number", choices: [], valueCount: 0 }]}
      onOpenChange={vi.fn()}
      onApply={onApply}
    />,
  );
  const dialog = page.getByRole("dialog");
  // "1e" is unfinished on the way to "1e3"; the typed text must survive it.
  await userEvent.type(dialog.getByRole("spinbutton", { name: "Value" }), "1e3");
  await dialog.getByRole("button", { name: "Save for 2 vouchers" }).click();
  expect(onApply).toHaveBeenCalledWith(1, 1000);
});
