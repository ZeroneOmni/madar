import { expect, it, vi } from "vite-plus/test";
import * as NodeEvents from "node:events";
import { deliverNotification } from "./notificationDelivery.ts";

it("suppresses foreground notifications and reports unsupported platforms", async () => {
  const create = vi.fn();
  const base = { create, activate: vi.fn(), supported: () => true, focused: () => true };
  expect(
    await deliverNotification({ title: "Saved", message: "Saved", path: "/settings" }, base),
  ).toEqual({ status: "suppressed" });
  expect(
    await deliverNotification(
      { title: "Saved", message: "Saved", path: "/settings" },
      { ...base, supported: () => false },
    ),
  ).toEqual({ status: "unsupported" });
  expect(create).not.toHaveBeenCalled();
});

it("observes delivery, activates the destination and reports OS failure", async () => {
  const events = new NodeEvents.EventEmitter();
  const activate = vi.fn();
  const input = { title: "Update ready", message: "Ready to install", path: "/settings/general" };
  const delivery = deliverNotification(input, {
    supported: () => true,
    focused: () => false,
    activate,
    create: () => ({ once: events.once.bind(events), show: () => events.emit("show") }),
  });
  expect(await delivery).toEqual({ status: "shown" });
  events.emit("click");
  expect(activate).toHaveBeenCalledWith(input.path);
  expect(
    await deliverNotification(input, {
      supported: () => true,
      focused: () => false,
      activate,
      create: () => ({ once: events.once.bind(events), show: () => events.emit("failed") }),
    }),
  ).toEqual({
    status: "failed",
    message: "The operating system could not display this notification.",
  });
});
