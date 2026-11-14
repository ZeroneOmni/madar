import { AuthAccessWriteScope, EnvironmentHttpApi } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as RouterApi from "./RouterApi.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "routers",
  Effect.fnUntraced(function* (handlers) {
    const api = yield* RouterApi.RouterApi;
    return handlers
      .handle(
        "probe",
        Effect.fn("routers.probe")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* api.connect(payload, principal.sessionId);
        }),
      )
      .handle(
        "status",
        Effect.fn("routers.status")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* api.status(payload.profileId, principal.sessionId);
        }),
      )
      .handle(
        "disconnect",
        Effect.fn("routers.disconnect")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return {
            disconnected: yield* api.disconnect(payload.profileId, principal.sessionId),
          };
        }),
      );
  }),
);
