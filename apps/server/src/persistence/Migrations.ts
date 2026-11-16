import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import LocalAuthentication from "./Migrations/001_LocalAuthentication.ts";
import Vouchers from "./Migrations/002_Vouchers.ts";

export const runMigrations = Effect.fn("runMigrations")(() =>
  Migrator.make({})({
    loader: Migrator.fromRecord({
      "001_LocalAuthentication": LocalAuthentication,
      "002_Vouchers": Vouchers,
    }),
  }),
);
