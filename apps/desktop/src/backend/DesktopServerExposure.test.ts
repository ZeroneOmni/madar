import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as DesktopServerExposure from "./DesktopServerExposure.ts";
it.effect("keeps the backend on loopback when its port changes", () =>
  Effect.gen(function* () {
    const exposure = yield* DesktopServerExposure.DesktopServerExposure;
    yield* exposure.configureFromSettings({ port: 3773 });
    assert.equal((yield* exposure.backendConfig).httpBaseUrl.href, "http://127.0.0.1:3773/");
    yield* exposure.configureFromSettings({ port: 4884 });
    const config = yield* exposure.backendConfig;
    assert.equal(config.bindHost, "127.0.0.1");
    assert.equal(config.httpBaseUrl.href, "http://127.0.0.1:4884/");
  }).pipe(Effect.provide(DesktopServerExposure.layer)),
);
