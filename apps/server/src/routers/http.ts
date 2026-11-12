import { AuthAccessWriteScope, EnvironmentHttpApi } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as RouterProbe from "./RouterProbe.ts";
import * as UserManagerConnection from "./UserManagerConnection.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "routers",
  Effect.fnUntraced(function* (handlers) {
    const probe = yield* RouterProbe.RouterProbe;
    const userManager = yield* UserManagerConnection.UserManagerConnection;
    return handlers
      .handle(
        "probe",
        Effect.fn("routers.probe")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          if (payload.profile.transport.startsWith("user-manager-"))
            return yield* userManager.check(payload, principal.sessionId);
          return yield* probe.check(payload);
        }),
      )
      .handle(
        "disconnect",
        Effect.fn("routers.disconnect")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return {
            disconnected: yield* userManager.disconnect(payload.profileId, principal.sessionId),
          };
        }),
      );
  }),
);
