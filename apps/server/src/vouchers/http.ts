import { AuthAccessWriteScope, EnvironmentHttpApi } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as VoucherService from "./VoucherService.ts";
import * as VoucherFieldStore from "./VoucherFieldStore.ts";
import * as VoucherSnapshotSync from "./VoucherSnapshotSync.ts";
import * as VoucherStore from "./VoucherStore.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "vouchers",
  Effect.fnUntraced(function* (handlers) {
    const vouchers = yield* VoucherService.VoucherService;
    const fields = yield* VoucherFieldStore.VoucherFieldStore;
    const snapshots = yield* VoucherSnapshotSync.VoucherSnapshotSync;
    const store = yield* VoucherStore.VoucherStore;
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
      )
      .handle(
        "fields",
        Effect.fn("vouchers.fields")(function* () {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* fields.list();
        }),
      )
      .handle(
        "saveField",
        Effect.fn("vouchers.saveField")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* fields.save(payload);
        }),
      )
      .handle(
        "reorderFields",
        Effect.fn("vouchers.reorderFields")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* fields.reorder(payload.ids);
        }),
      )
      .handle(
        "deleteField",
        Effect.fn("vouchers.deleteField")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* fields.remove(payload.id, payload.valueCount);
        }),
      )
      .handle(
        "setFieldValues",
        Effect.fn("vouchers.setFieldValues")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* fields.setValues(payload);
        }),
      )
      .handle(
        "databaseStatus",
        Effect.fn("vouchers.databaseStatus")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* snapshots.status(payload);
        }),
      )
      .handle(
        "databaseStart",
        Effect.fn("vouchers.databaseStart")(function* ({ payload }) {
          const principal = yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* snapshots.start(payload, principal.sessionId);
        }),
      )
      .handle(
        "databaseCancel",
        Effect.fn("vouchers.databaseCancel")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* snapshots.cancel(payload);
        }),
      )
      .handle(
        "databaseTrust",
        Effect.fn("vouchers.databaseTrust")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* snapshots.trust(payload, payload.hostKey);
        }),
      )
      .handle(
        "assignments",
        Effect.fn("vouchers.assignments")(function* ({ payload }) {
          yield* requireEnvironmentScope(AuthAccessWriteScope);
          return yield* store.assignments(payload);
        }),
      );
  }),
);
