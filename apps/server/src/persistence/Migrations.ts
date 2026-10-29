import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import LocalAuthentication from "./Migrations/001_LocalAuthentication.ts";

export const runMigrations = Effect.fn("runMigrations")(() =>
  Migrator.make({})({
    loader: Migrator.fromRecord({ "001_LocalAuthentication": LocalAuthentication }),
  }),
);
