import { expect, it } from "vite-plus/test";
import { voucherError } from "./client";

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
