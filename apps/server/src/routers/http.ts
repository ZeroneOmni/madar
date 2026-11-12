import { AuthAccessWriteScope, EnvironmentHttpApi } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as RouterProbe from "./RouterProbe.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "routers",
  Effect.fnUntraced(function* (handlers) {
    const probe = yield* RouterProbe.RouterProbe;
    return handlers.handle(
      "probe",
      Effect.fn("routers.probe")(function* ({ payload }) {
        yield* requireEnvironmentScope(AuthAccessWriteScope);
        return yield* probe.check(payload);
      }),
    );
  }),
);
