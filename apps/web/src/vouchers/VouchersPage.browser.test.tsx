import { expect, it, vi } from "vite-plus/test";
import { render } from "../../test/render";
import { VouchersPage } from "./VouchersPage";
import { voucherClient, VoucherRequestError } from "./client";
import { voucherRow } from "../../test/voucherRow";

vi.mock("../routers/RouterConnections", () => ({
  useRouters: () => ({
    catalog: {
      selected: "test",
      routers: [
        {
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
      ],
    },
    state: { kind: "connected", service: "router-api" },
  }),
}));

it("selects cached vouchers without reloading and shows a rejected operation's cause", async () => {
  const catalog = { customers: ["admin"], profiles: [], syncedAt: "2026-11-16T00:00:00Z" };
  using _catalog = vi.spyOn(voucherClient, "catalog").mockResolvedValue(catalog);
  using _sync = vi.spyOn(voucherClient, "sync").mockResolvedValue(catalog);
  using _history = vi.spyOn(voucherClient, "history").mockResolvedValue([]);
  using list = vi.spyOn(voucherClient, "list").mockResolvedValue({
    items: [voucherRow()],
    total: 1,
    syncedAt: catalog.syncedAt,
    complete: true,
  });
  using mutate = vi
    .spyOn(voucherClient, "mutate")
    .mockRejectedValue(new VoucherRequestError("Connect to the router to continue."));
  await using screen = await render(<VouchersPage />);
  const checkbox = screen.getByRole("checkbox", { name: "Select voucher voucher", exact: true });
  await expect.element(checkbox).toBeVisible();
  const calls = list.mock.calls.length;
  await checkbox.click();
  await expect.element(screen.getByText("1 selected", { exact: true })).toBeVisible();
  expect(list).toHaveBeenCalledTimes(calls);
  await screen.getByRole("button", { name: "Disable", exact: true }).click();
  await screen.getByRole("button", { name: "Confirm", exact: true }).click();
  await expect
    .element(screen.getByRole("dialog").getByRole("alert"))
    .toHaveTextContent("Connect to the router to continue.");
  expect(mutate).toHaveBeenCalledOnce();
});
import "../index.css";

it("sorts from the column header and keeps the choice for this device", async () => {
  localStorage.removeItem("madar:voucher-layout");
  using _cleanup = { [Symbol.dispose]: () => localStorage.removeItem("madar:voucher-layout") };
  const catalog = { customers: ["admin"], profiles: [], syncedAt: "2026-11-16T00:00:00Z" };
  using _catalog = vi.spyOn(voucherClient, "catalog").mockResolvedValue(catalog);
  using _sync = vi.spyOn(voucherClient, "sync").mockResolvedValue(catalog);
  using _history = vi.spyOn(voucherClient, "history").mockResolvedValue([]);
  using list = vi.spyOn(voucherClient, "list").mockResolvedValue({
    items: [voucherRow()],
    total: 1,
    syncedAt: catalog.syncedAt,
    complete: true,
  });
  await using screen = await render(<VouchersPage />);
  const header = screen.getByRole("columnheader").filter({ hasText: "Last seen" });
  await expect.element(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button", { name: "Last seen", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "ascending");
  await header.getByRole("button", { name: "Last seen", exact: true }).click();
  await expect.element(header).toHaveAttribute("aria-sort", "descending");
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ sort: { field: "lastSeen", direction: "desc" }, offset: 0 }),
    expect.anything(),
  );
  await expect
    .element(screen.getByRole("status").filter({ hasText: "Sorted by Last seen, descending" }))
    .toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem("madar:voucher-layout") ?? "{}").sort).toEqual({
    field: "lastSeen",
    direction: "desc",
  });
});
