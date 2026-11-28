import * as Migrator from "effect/sql/Migrator";
import * as Effect from "effect/Effect";
import LocalAuthentication from "./Migrations/001_LocalAuthentication.ts";
import Vouchers from "./Migrations/002_Vouchers.ts";
import VoucherColumns from "./Migrations/003_VoucherColumns.ts";
import VoucherFields from "./Migrations/004_VoucherFields.ts";
import VoucherAssignmentSnapshots from "./Migrations/005_VoucherAssignmentSnapshots.ts";
import VoucherCopyTiming from "./Migrations/006_VoucherCopyTiming.ts";
import VoucherOnlyPackage from "./Migrations/007_VoucherOnlyPackage.ts";
import VoucherCopyKept from "./Migrations/008_VoucherCopyKept.ts";

export const runMigrations = Effect.fn("runMigrations")(() =>
  Migrator.make({})({
    loader: Migrator.fromRecord({
      "001_LocalAuthentication": LocalAuthentication,
      "002_Vouchers": Vouchers,
      "003_VoucherColumns": VoucherColumns,
      "004_VoucherFields": VoucherFields,
      "005_VoucherAssignmentSnapshots": VoucherAssignmentSnapshots,
      "006_VoucherCopyTiming": VoucherCopyTiming,
      "007_VoucherOnlyPackage": VoucherOnlyPackage,
      "008_VoucherCopyKept": VoucherCopyKept,
    }),
  }),
);
