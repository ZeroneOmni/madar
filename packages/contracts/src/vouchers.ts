import * as Schema from "effect/Schema";
import { RouterProfile } from "./routers.ts";

const Text = Schema.String.check(Schema.isMaxLength(512));
const Name = Text.check(Schema.isMinLength(1));
const Integer = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Count = Schema.NullOr(Integer);
/** Router-local wall-clock time without a zone, "YYYY-MM-DD HH:MM:SS". */
const RouterTime = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/));
const SharedUsers = Schema.NullOr(Schema.Union([Integer, Schema.Literal("unlimited")]));
export const VoucherRemaining = Schema.Struct({
  state: Schema.Literals([
    "none",
    "unlimited",
    "unknown",
    "left",
    "ends",
    "used-up",
    "expired",
    "not-started",
  ]),
  reason: Schema.Literals([
    "",
    "catalog",
    "limits",
    "counters",
    "baseline",
    "activation",
    "first-login",
    "clock",
  ]),
  kind: Schema.Literals(["", "transfer", "download", "upload", "uptime", "validity"]),
  amount: Count,
  limit: Count,
  endsAt: Schema.NullOr(RouterTime),
  basis: Schema.Literals(["", "activation", "new", "profile-change", "counter-reset"]),
});
export type VoucherRemaining = typeof VoucherRemaining.Type;
/** "Nearly used up or expiring": at most this share of data left, or this many seconds of validity. */
export const VOUCHER_NEARLY_ENDED = { ratio: 0.1, seconds: 86_400 } as const;
export const VoucherBatch = Schema.Struct({
  id: Integer,
  createdAt: Schema.String,
  requested: Integer,
  created: Integer,
  profile: Text,
  comment: Text,
});
export type VoucherBatch = typeof VoucherBatch.Type;
export const Voucher = Schema.Struct({
  id: Name,
  customer: Text,
  username: Name,
  comment: Text,
  disabled: Schema.Boolean,
  active: Schema.Boolean,
  incomplete: Schema.Boolean,
  profile: Text,
  sharedUsers: SharedUsers,
  download: Count,
  upload: Count,
  uptime: Count,
  lastSeen: Schema.NullOr(Schema.Union([Schema.Literal("never"), RouterTime])),
  activeSessions: Count,
  registrationDate: Schema.NullOr(RouterTime),
  callerId: Text,
  callerIdBind: Schema.Boolean,
  ipAddress: Text,
  ipv6Dns: Text,
  ipv6Prefix: Text,
  wirelessEncryption: Text,
  firstName: Text,
  lastName: Text,
  phone: Text,
  email: Text,
  location: Text,
  observedAt: Schema.String,
  firstSeenAt: Schema.String,
  changedAt: Schema.String,
});
export type Voucher = typeof Voucher.Type;
export const VoucherQuota = Schema.Struct({
  transfer: Count,
  download: Count,
  upload: Count,
  uptime: Count,
});
export type VoucherQuota = typeof VoucherQuota.Type;
export const VoucherRow = Schema.Struct({
  ...Voucher.fields,
  price: Schema.NullOr(Schema.Number),
  quota: VoucherQuota,
  validity: Count,
  firstLoginAt: Schema.NullOr(RouterTime),
  batch: Schema.NullOr(VoucherBatch),
  remaining: VoucherRemaining,
});
export type VoucherRow = typeof VoucherRow.Type;
export const VoucherProfile = Schema.Struct({
  name: Name,
  owner: Text,
  nameForUsers: Text,
  validity: Count,
  startsAt: Text,
  price: Schema.NullOr(Schema.Number),
  overrideSharedUsers: SharedUsers,
  quota: VoucherQuota,
});
export type VoucherProfile = typeof VoucherProfile.Type;
export const VoucherCatalog = Schema.Struct({
  customers: Schema.Array(Schema.String),
  profiles: Schema.Array(VoucherProfile),
  syncedAt: Schema.NullOr(Schema.String),
});
export type VoucherCatalog = typeof VoucherCatalog.Type;
export const VoucherScope = Schema.Struct({ router: RouterProfile, customer: Name });
export type VoucherScope = typeof VoucherScope.Type;
export const VoucherSortField = Schema.Literals([
  "username",
  "comment",
  "state",
  "profile",
  "remaining",
  "dataUsed",
  "uptime",
  "lastSeen",
  "download",
  "upload",
  "activeSessions",
  "created",
  "price",
  "quota",
  "sharedUsers",
  "macLock",
  "macBind",
  "ipAddress",
  "ipv6Dns",
  "ipv6Prefix",
  "wireless",
  "flags",
  "activeFlag",
  "incompleteFlag",
  "firstName",
  "lastName",
  "phone",
  "email",
  "location",
  "firstSeen",
  "changed",
  "firstLogin",
  "batch",
]);
export type VoucherSortField = typeof VoucherSortField.Type;
export const VoucherSort = Schema.Struct({
  field: VoucherSortField,
  direction: Schema.Literals(["asc", "desc"]),
});
export type VoucherSort = typeof VoucherSort.Type;
export const VoucherStatusFilter = Schema.Literals([
  "all",
  "enabled",
  "disabled",
  "online",
  "unassigned",
  "low",
  "ended",
  "unknown",
]);
export type VoucherStatusFilter = typeof VoucherStatusFilter.Type;
export const VoucherQuery = Schema.Struct({
  ...VoucherScope.fields,
  search: Text,
  status: VoucherStatusFilter,
  profile: Text,
  sort: VoucherSort,
  offset: Integer,
  limit: Integer.check(Schema.isBetween({ minimum: 1, maximum: 200 })),
});
export type VoucherQuery = typeof VoucherQuery.Type;
export const VoucherPage = Schema.Struct({
  items: Schema.Array(VoucherRow),
  total: Integer,
  syncedAt: Schema.NullOr(Schema.String),
  complete: Schema.Boolean,
});
export type VoucherPage = typeof VoucherPage.Type;
export const VoucherTarget = Schema.Struct({ ...VoucherScope.fields, id: Name });
export type VoucherTarget = typeof VoucherTarget.Type;
export const VoucherDetails = Schema.Struct({
  voucher: Schema.NullOr(VoucherRow),
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
