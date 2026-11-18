import { expect, it } from "vite-plus/test";
import type { RouterProfile } from "@madar/contracts";
import { CATALOG_KEY, decodeCatalog, emptyCatalog, profileForSave, saveCatalog } from "./catalog";

it("starts with no router and round-trips the saved catalog", () => {
  expect(decodeCatalog(null)).toEqual(emptyCatalog);
  const setItem = (key: string, value: string) => {
    expect(key).toBe(CATALOG_KEY);
    expect(decodeCatalog(value)).toEqual(emptyCatalog);
  };
  saveCatalog({ setItem }, emptyCatalog);
});
it("rejects an invalid selected router instead of silently using another router", () => {
  expect(() => decodeCatalog(JSON.stringify({ routers: [], selected: "missing" }))).toThrow();
});
it("propagates failed saves so the caller can preserve the current catalog", () => {
  expect(() =>
    saveCatalog(
      {
        setItem: () => {
          throw new Error("Full");
        },
      },
      emptyCatalog,
    ),
  ).toThrow("Full");
});

const native: RouterProfile = {
  id: "router",
  name: "Router",
  host: "router.local",
  port: 8728,
  username: "admin",
  transport: "tcp",
  color: "blue",
  icon: "router",
  label: "",
};
const secure = {
  ...native,
  port: 8729,
  transport: "tls",
  tlsCertificate: "verified-certificate",
} as const;

it("saves a changed secure endpoint with a different identity and a distinguishable name", () => {
  expect(profileForSave(secure, native, "separate-router")).toEqual({
    ...secure,
    id: "separate-router",
    name: "Router (API-SSL)",
  });
});

it("updates the certificate in place when the secure endpoint stays the same", () => {
  const renewed = { ...secure, tlsCertificate: "renewed-certificate" };
  expect(profileForSave(renewed, secure, "unused-id")).toEqual(renewed);
});

it("keeps the original account when guided setup uses different credentials at the same endpoint", () => {
  const alternative = { ...secure, username: "setup-admin", tlsCertificate: "renewed-certificate" };
  expect(profileForSave(alternative, secure, "separate-router")).toEqual({
    ...alternative,
    id: "separate-router",
    name: "Router (setup-admin)",
  });
});

it("requires a new certificate verification when a pinned API-SSL endpoint changes", () => {
  expect(profileForSave({ ...secure, name: "New label" }, secure)?.tlsCertificate).toBe(
    secure.tlsCertificate,
  );
  const moved = { ...secure, host: "replacement.local" };
  expect(profileForSave(moved, secure)).toBeNull();
  expect(profileForSave({ ...secure, port: 9729 }, secure)).toBeNull();
  expect(
    profileForSave({ ...moved, tlsCertificate: "new-certificate" }, secure, "separate-router")
      ?.tlsCertificate,
  ).toBe("new-certificate");
  expect(profileForSave({ ...secure, ...native }, secure)?.tlsCertificate).toBeUndefined();
});
