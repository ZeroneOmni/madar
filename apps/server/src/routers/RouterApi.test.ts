// @effect-diagnostics nodeBuiltinImport:off
import * as NodeTls from "node:tls";
import { it, expect } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as RouterApi from "./RouterApi.ts";
import { routerFixture } from "../vouchers/routerFixture.ts";

import { TEST_KEY, TEST_CERT } from "./tlsFixture.ts";

it.effect("preserves persistent router keys when certificates are added or renewed", () =>
  Effect.sync(() => {
    const profile = {
      id: "fixture",
      name: "Fixture",
      host: "Router.local",
      port: 8728,
      transport: "tcp" as const,
      username: "admin",
      color: "blue" as const,
      icon: "router" as const,
      label: "",
    };
    const key = '["router.local",8728,"tcp","admin"]';
    expect(RouterApi.routerKey(profile)).toBe(key);
    expect(RouterApi.routerKey({ ...profile, tlsCertificate: TEST_CERT })).toBe(key);
  }),
);

it.live("requires reconnection when a profile certificate changes", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(
      Effect.promise(() => routerFixture(0, { tls: { key: TEST_KEY, cert: TEST_CERT } })),
    );
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      const profile = { ...router.profile, tlsCertificate: TEST_CERT };
      expect((yield* api.connect({ profile, password: "fixture" }, "owner")).kind).toBe(
        "connected",
      );
      const result = yield* api
        .execute(router.profile, "owner", ["/system/identity/print"])
        .pipe(Effect.flip);
      expect(result.reason).toBe("disconnected");
    }).pipe(Effect.provide(RouterApi.layer));
  }).pipe(Effect.scoped),
);

it.live("keeps an authenticated socket after its connection deadline is cleared", () =>
  Effect.gen(function* () {
    const router = yield* Effect.acquireDisposable(Effect.promise(() => routerFixture(0)));
    yield* Effect.gen(function* () {
      const api = yield* RouterApi.RouterApi;
      using deadlines = vi.spyOn(globalThis, "setTimeout");
      using cleared = vi.spyOn(globalThis, "clearTimeout");
      expect(
        (yield* api.connect({ profile: router.profile, password: "fixture" }, "owner")).kind,
      ).toBe("connected");
      for (const [index, [callback, delay]] of deadlines.mock.calls.entries()) {
        const timer = deadlines.mock.results[index]?.value;
        if (delay === 10000 && !cleared.mock.calls.some(([value]) => value === timer)) callback();
      }
      yield* api.execute(router.profile, "owner", ["/system/identity/print"]);
      expect(router.commands.filter((words) => words[0] === "/login")).toHaveLength(1);
    }).pipe(Effect.provide(RouterApi.layer));
  }).pipe(Effect.scoped),
);

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
