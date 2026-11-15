import * as Schema from "effect/Schema";
import { RouterProfile } from "./routers.ts";

const Text = Schema.String.check(Schema.isMaxLength(512));
const Name = Text.check(Schema.isMinLength(1));
const Integer = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const Voucher = Schema.Struct({
  id: Name,
  customer: Text,
  username: Name,
  disabled: Schema.Boolean,
  profile: Text,
  sharedUsers: Text,
  comment: Text,
  upload: Text,
  download: Text,
  uptime: Text,
  lastSeen: Text,
  activeSessions: Text,
  observedAt: Schema.String,
});
export type Voucher = typeof Voucher.Type;
export const VoucherProfile = Schema.Struct({
  name: Name,
  owner: Text,
  validity: Text,
  startsAt: Text,
  price: Text,
});
export const VoucherCatalog = Schema.Struct({
  customers: Schema.Array(Schema.String),
  profiles: Schema.Array(VoucherProfile),
  syncedAt: Schema.NullOr(Schema.String),
});
export type VoucherCatalog = typeof VoucherCatalog.Type;
export const VoucherScope = Schema.Struct({ router: RouterProfile, customer: Name });
export type VoucherScope = typeof VoucherScope.Type;
export const VoucherQuery = Schema.Struct({
  ...VoucherScope.fields,
  search: Text,
  status: Schema.Literals(["all", "enabled", "disabled", "online", "unassigned"]),
  profile: Text,
  sort: Schema.Literals(["username", "profile", "lastSeen"]),
  descending: Schema.Boolean,
  offset: Integer,
  limit: Integer.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
});
export type VoucherQuery = typeof VoucherQuery.Type;
export const VoucherPage = Schema.Struct({
  items: Schema.Array(Voucher),
  total: Integer,
  syncedAt: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});
export type VoucherPage = typeof VoucherPage.Type;
export const VoucherTarget = Schema.Struct({ ...VoucherScope.fields, id: Name });
export type VoucherTarget = typeof VoucherTarget.Type;
export const VoucherDetails = Schema.Struct({
  voucher: Schema.NullOr(Voucher),
  password: Schema.NullOr(Schema.String),
  sessions: Schema.Array(Schema.Record(Schema.String, Schema.String)),
  sessionsAvailable: Schema.Boolean,
});
export type VoucherDetails = typeof VoucherDetails.Type;
const CreateItem = Schema.Struct({
  username: Name,
  password: Schema.String.check(Schema.isMaxLength(128)),
});
export const VoucherAction = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("create"),
    items: Schema.Array(CreateItem).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    profile: Text,
    sharedUsers: Integer.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    comment: Text,
  }),
  Schema.Struct({
    kind: Schema.Literal("edit"),
    id: Name,
    username: Name,
    password: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(128))),
    sharedUsers: Integer.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    comment: Text,
  }),
  Schema.Struct({
    kind: Schema.Literals(["enable", "disable", "remove", "reset-counters", "assign-profile"]),
    ids: Schema.Array(Name).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    profile: Text,
  }),
]);
export type VoucherAction = typeof VoucherAction.Type;
export const VoucherMutation = Schema.Struct({
  ...VoucherScope.fields,
  requestId: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]{16,80}$/)),
  action: VoucherAction,
});
export type VoucherMutation = typeof VoucherMutation.Type;
export const VoucherOperation = Schema.Struct({
  requestId: Schema.String,
  kind: Schema.String,
  createdAt: Schema.String,
  state: Schema.Literals(["running", "completed", "attention"]),
  outcomes: Schema.Array(
    Schema.Struct({
      target: Schema.String,
      state: Schema.Literals(["pending", "confirmed", "failed", "uncertain", "partial"]),
      reason: Schema.String,
    }),
  ),
});
export type VoucherOperation = typeof VoucherOperation.Type;
export const VoucherFailureReason = Schema.Literals([
  "disconnected",
  "authentication",
  "network",
  "tls",
  "timeout",
  "protocol",
  "unsupported",
  "permission",
  "rejected",
  "storage",
  "not-found",
  "conflict",
  "busy",
]);
export type VoucherFailureReason = typeof VoucherFailureReason.Type;
export class VoucherFailure extends Schema.TaggedError<VoucherFailure>()(
  "VoucherFailure",
  {
    reason: VoucherFailureReason,
  },
  { httpApiStatus: 400 },
) {}
