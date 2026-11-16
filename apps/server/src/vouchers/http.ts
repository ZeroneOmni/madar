import { AuthAccessWriteScope, EnvironmentHttpApi } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as VoucherService from "./VoucherService.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "vouchers",
  Effect.fnUntraced(function* (handlers) {
    const vouchers = yield* VoucherService.VoucherService;
    return handlers
      .handle(
        "catalog",
        Effect.fn("vouchers.catalog")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* payload.refresh
            ? vouchers.discover(payload.router, principal.sessionId)
            : vouchers.catalog(payload.router);
        }),
      )
      .handle(
        "list",
        Effect.fn("vouchers.list")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* vouchers.list(payload);
        }),
      )
      .handle(
        "sync",
        Effect.fn("vouchers.sync")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* vouchers.sync(payload, principal.sessionId);
        }),
      )
      .handle(
        "details",
        Effect.fn("vouchers.details")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* vouchers.details(payload, principal.sessionId);
        }),
      )
      .handle(
        "mutate",
        Effect.fn("vouchers.mutate")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* vouchers.mutate(payload, principal.sessionId);
        }),
      )
      .handle(
        "history",
        Effect.fn("vouchers.history")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* vouchers.history(payload);
        }),
      );
  }),
);
