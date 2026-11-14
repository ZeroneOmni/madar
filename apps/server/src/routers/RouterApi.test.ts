// @effect-diagnostics nodeBuiltinImport:off
import * as NodeTls from "node:tls";
import { it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as RouterApi from "./RouterApi.ts";
import { routerFixture } from "../vouchers/routerFixture.ts";

// Non-secret, self-signed 127.0.0.1 certificate, valid until 2126; ALPN h2 requires TLS.
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3EwCztQysKTvzdcR
g0LWq+axzUd4tHi9PyMdqh7PlGShRANCAARfQpoLgv/tOsHWCLriDza7Ruaey2b7
mR/nS6mLu6W7+agkEqDm0mE3F/ngpPjL4Jj0IGadeMcKNKFRSBgiLdfn
-----END PRIVATE KEY-----
`;
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIBsDCCAVagAwIBAgIUWbn2Wt5kTxii1UU57NJMt/wTaUgwCgYIKoZIzj0EAwIw
JDEiMCAGA1UEAwwZdDNjb2RlIG91dGJvdW5kIGh0dHAgdGVzdDAgFw0yNjEwMTEy
MjQyMzZaGA8yMTI2MDkxNzIyNDIzNlowJDEiMCAGA1UEAwwZdDNjb2RlIG91dGJv
dW5kIGh0dHAgdGVzdDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABF9CmguC/+06
wdYIuuIPNrtG5p7LZvuZH+dLqYu7pbv5qCQSoObSYTcX+eCk+MvgmPQgZp14xwo0
oVFIGCIt1+ejZDBiMB0GA1UdDgQWBBSsekAc30Q/zdIE/tvVDQKJL5oiCDAfBgNV
HSMEGDAWgBSsekAc30Q/zdIE/tvVDQKJL5oiCDAPBgNVHRMBAf8EBTADAQH/MA8G
A1UdEQQIMAaHBH8AAAEwCgYIKoZIzj0EAwIDSAAwRQIgebUrkyP56242EJB7nCV7
A+Ke/q0rNPya3fjQa9O5B+kCIQC1SfmdNaFcNJ4JINlus4FfrRnfKiADS2MIJR9f
99BN0A==
-----END CERTIFICATE-----
`;

it.live("verifies API-SSL certificates and never sends credentials before TLS verification", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(
      Effect.promise(() => routerFixture(0, { tls: { key: TEST_KEY, cert: TEST_CERT } })),
    );
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      expect(yield* api.connect({ profile: router.profile, password: "fixture" }, "owner")).toEqual(
        { kind: "failed", reason: "tls" },
      );
      expect(router.commands).toHaveLength(0);
      const original = NodeTls.getCACertificates("default");
      yield* Effect.acquireRelease(
        Effect.sync(() => NodeTls.setDefaultCACertificates([...original, TEST_CERT])),
        () => Effect.sync(() => NodeTls.setDefaultCACertificates(original)),
      );
      expect(
        (yield* api.connect({ profile: router.profile, password: "fixture" }, "owner")).kind,
      ).toBe("connected");
      expect(
        yield* api.connect(
          { profile: { ...router.profile, host: "localhost" }, password: "fixture" },
          "owner",
        ),
      ).toEqual({ kind: "failed", reason: "tls" });
    }).pipe(Effect.provide(RouterApi.layer));
  }).pipe(Effect.scoped),
);

it.live("supports legacy challenge login and rejects wrong passwords and RouterOS 7", () =>
  Effect.gen(function* () {
    const legacy = yield* Effect.acquireDisposable(
      Effect.promise(() => routerFixture(0, { legacy: true, version: "6.42.12" })),
    );
    const modern = yield* Effect.acquireDisposable(
      Effect.promise(() => routerFixture(0, { version: "7.20" })),
    );
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      expect(
        (yield* api.connect({ profile: legacy.profile, password: "fixture" }, "owner")).kind,
      ).toBe("connected");
      expect(
        yield* api.connect(
          { profile: { ...modern.profile, id: "modern" }, password: "wrong" },
          "owner",
        ),
      ).toEqual({ kind: "failed", reason: "authentication" });
      expect(
        yield* api.connect(
          { profile: { ...modern.profile, id: "modern" }, password: "fixture" },
          "owner",
        ),
      ).toEqual({ kind: "failed", reason: "unsupported" });
    }).pipe(Effect.provide(RouterApi.layer));
  }).pipe(Effect.scoped),
);
