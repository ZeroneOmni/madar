import { expect, it } from "vite-plus/test";
import { createVoucherItems, voucherError } from "./client";

it("keeps a blank password empty with an entered or generated username", () => {
  expect(createVoucherItems(1, "voucher", "", "")).toEqual([{ username: "voucher", password: "" }]);
  expect(createVoucherItems(1, "", "", "pre-")).toEqual([
    { username: expect.stringMatching(/^pre-.{10}$/), password: "" },
  ]);
});

it("preserves an entered password and generates credentials for bulk creation", () => {
  expect(createVoucherItems(1, "voucher", "chosen-password", "")).toEqual([
    { username: "voucher", password: "chosen-password" },
  ]);
  const items = createVoucherItems(2, "voucher", "chosen-password", "pre-");
  expect(items).toHaveLength(2);
  for (const item of items) {
    expect(item.username).toMatch(/^pre-.{10}$/);
    expect(item.password).toHaveLength(12);
  }
});

it("keeps transport and parser diagnostics out of user messages", () => {
  expect(voucherError(new SyntaxError("Unexpected end of JSON input"))).toBe(
    "Madar could not complete the request. Check the app connection.",
  );
  expect(voucherError(new Error("Failed to fetch private diagnostic"))).toBe(
    "Madar could not complete the request. Check the app connection.",
  );
  expect(voucherError(new Error("Connect to the router to continue."))).toBe(
    "Connect to the router to continue.",
  );
});
