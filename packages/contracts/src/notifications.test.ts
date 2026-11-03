import { expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { DesktopNotificationInput } from "./notifications.ts";

it("rejects notification destinations that can escape shell navigation", () => {
  const decode = Schema.decodeUnknownSync(DesktopNotificationInput);
  expect(decode({ title: "Saved", message: "Done", path: "/settings/privacy" }).path).toBe(
    "/settings/privacy",
  );
  expect(() => decode({ title: "Saved", message: "Done", path: "https://example.com" })).toThrow();
  expect(() => decode({ title: "", message: "Done", path: "/settings" })).toThrow();
});
