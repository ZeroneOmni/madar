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
    /** Only a router database copy older than a day describes the current package. */
    "stale",
  ]),
  kind: Schema.Literals(["", "transfer", "download", "upload", "uptime", "validity"]),
  amount: Count,
  limit: Count,
  endsAt: Schema.NullOr(RouterTime),
  basis: Schema.Literals([
    "",
    "activation",
    "new",
    "profile-change",
    "counter-reset",
    /** Package usage as recorded in the router database copy. */
    "router-database",
    /** The copy's package usage plus the router counters' growth since the copy. */
    "router-database-live",
    /** A router database copy showed this is the voucher's only package: its live counters. */
    "only-package",
  ]),
  /** When the router database copy used for this value was taken (Madar time, ISO). */
  capturedAt: Schema.NullOr(Schema.String),
  /** User Manager wrote to its database during that copy, so its values are approximate. */
  capturedBusy: Schema.Boolean,
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
/** Local fields: app-wide definitions with typed values saved by Madar, never sent to the router. */
export const VoucherFieldType = Schema.Literals(["text", "number", "date", "boolean", "choice"]);
export type VoucherFieldType = typeof VoucherFieldType.Type;
const FieldLabel = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64));
const FieldId = Integer.check(Schema.isGreaterThanOrEqualTo(1));
/** A calendar date without a time or zone, "YYYY-MM-DD". */
const LocalDate = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/));
export const VoucherFieldChoice = Schema.Struct({ id: FieldId, label: FieldLabel });
export const VoucherField = Schema.Struct({
  id: FieldId,
  name: FieldLabel,
  type: VoucherFieldType,
  choices: Schema.Array(VoucherFieldChoice),
  valueCount: Integer,
});
export type VoucherField = typeof VoucherField.Type;
/** Text and dates are strings, numbers are numbers, yes/no is a boolean, a choice is its id. */
export const VoucherFieldValue = Schema.Union([
  Text,
  Schema.Number.check(Schema.isFinite()),
  Schema.Boolean,
]);
export type VoucherFieldValue = typeof VoucherFieldValue.Type;
export const VoucherFieldDraft = Schema.Struct({
  id: Schema.optionalKey(FieldId),
  name: FieldLabel,
  type: VoucherFieldType,
  choices: Schema.Array(
    Schema.Struct({ id: Schema.optionalKey(FieldId), label: FieldLabel }),
  ).check(Schema.isMaxLength(50)),
});
export type VoucherFieldDraft = typeof VoucherFieldDraft.Type;
export const VoucherFieldOrder = Schema.Struct({
  ids: Schema.Array(FieldId).check(Schema.isMaxLength(200)),
});
/** Deletes a field only while it still has the value count the operator confirmed. */
export const VoucherFieldDelete = Schema.Struct({ id: FieldId, valueCount: Integer });
export const VoucherFieldFilter = Schema.Union([
  Schema.Struct({ fieldId: FieldId, op: Schema.Literals(["empty", "filled"]) }),
  Schema.Struct({ fieldId: FieldId, op: Schema.Literal("contains"), text: Name }),
  Schema.Struct({
    fieldId: FieldId,
    op: Schema.Literal("range"),
    min: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
    max: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  }),
  Schema.Struct({
    fieldId: FieldId,
    op: Schema.Literal("dates"),
    from: Schema.NullOr(LocalDate),
    to: Schema.NullOr(LocalDate),
  }),
  Schema.Struct({ fieldId: FieldId, op: Schema.Literal("flag"), value: Schema.Boolean }),
  Schema.Struct({ fieldId: FieldId, op: Schema.Literal("choice"), choiceId: FieldId }),
]);
export type VoucherFieldFilter = typeof VoucherFieldFilter.Type;
/**
 * Usage of the current package: from the live counters when Madar knows where the package began,
 * otherwise from a fresh router database copy. Null when neither applies.
 */
export const VoucherPackageUsage = Schema.Struct({
  download: Integer,
  upload: Integer,
  uptime: Integer,
  startedAt: Schema.NullOr(RouterTime),
  endsAt: Schema.NullOr(RouterTime),
  /** The copy's usage plus the counters' growth since the copy. */
  estimated: Schema.Boolean,
  /** The copy the usage comes from; null when it comes from the live counters. */
  capturedAt: Schema.NullOr(Schema.String),
  /** User Manager wrote to its database during the copy, so its values are approximate. */
  capturedBusy: Schema.Boolean,
});
export type VoucherPackageUsage = typeof VoucherPackageUsage.Type;
export const VoucherRow = Schema.Struct({
  ...Voucher.fields,
  price: Schema.NullOr(Schema.Number),
  quota: VoucherQuota,
  validity: Count,
  firstLoginAt: Schema.NullOr(RouterTime),
  batch: Schema.NullOr(VoucherBatch),
  remaining: VoucherRemaining,
  package: Schema.NullOr(VoucherPackageUsage),
  /** Local field values by field id. */
  fields: Schema.Record(Schema.String, VoucherFieldValue),
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
  "packageUsage",
  "packageStart",
  "packageEnd",
  "custom",
]);
export type VoucherSortField = typeof VoucherSortField.Type;
export const VoucherSort = Schema.Struct({
  field: VoucherSortField,
  direction: Schema.Literals(["asc", "desc"]),
  /** Required with the "custom" field. */
  fieldId: Schema.optionalKey(FieldId),
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
  fieldFilter: Schema.optionalKey(VoucherFieldFilter),
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
export const VoucherFieldValues = Schema.Struct({
  ...VoucherScope.fields,
  ids: Schema.Array(Name).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  values: Schema.Array(
    Schema.Struct({ fieldId: FieldId, value: Schema.NullOr(VoucherFieldValue) }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
});
export type VoucherFieldValues = typeof VoucherFieldValues.Type;
export const VoucherFieldValuesResult = Schema.Struct({ updated: Integer });

/** One package assignment recorded in the router database copy, newest first. */
export const VoucherAssignment = Schema.Struct({
  /** User Manager's own id for this assignment. */
  id: Integer,
  profile: Text,
  assignedAt: Schema.NullOr(RouterTime),
  startedAt: Schema.NullOr(RouterTime),
  endsAt: Schema.NullOr(RouterTime),
  /** User Manager's raw state code. Its meanings are not confirmed, so clients must not label it. */
  state: Count,
  /** The profile's list price when it was assigned; not a record of a payment. */
  price: Schema.NullOr(Schema.Number),
  download: Integer,
  upload: Integer,
  uptime: Integer,
  current: Schema.Boolean,
});
export type VoucherAssignment = typeof VoucherAssignment.Type;
export const VoucherAssignments = Schema.Struct({
  capturedAt: Schema.NullOr(Schema.String),
  capturedBusy: Schema.Boolean,
  items: Schema.Array(VoucherAssignment),
});
export type VoucherAssignments = typeof VoucherAssignments.Type;

/** Steps of copying and reading the router's User Manager database file. */
export const RouterDatabaseStage = Schema.Literals([
  "connect",
  "check",
  "download",
  "verify",
  "read",
  "save",
]);
export type RouterDatabaseStage = typeof RouterDatabaseStage.Type;
export const RouterDatabaseFailureReason = Schema.Literals([
  /** No live router API session to take the credential and SSH port from. */
  "disconnected",
  /** SSH is disabled or refused the connection. */
  "ssh-off",
  "authentication",
  "permission",
  /** The router's SSH host key differs from the one Madar trusted. */
  "host-key",
  "not-found",
  "too-large",
  "network",
  "timeout",
  "stalled",
  /** User Manager kept writing to its database, and no copy was readable after several tries. */
  "busy",
  /** The copied file is not an SQLite database, or is damaged although nothing wrote to it. */
  "corrupt",
  /** The file's tables or columns are not the User Manager 6 layout Madar knows. */
  "schema",
  "values",
  "storage",
]);
export type RouterDatabaseFailureReason = typeof RouterDatabaseFailureReason.Type;
export const RouterDatabaseTrigger = Schema.Literals(["first", "automatic", "manual"]);
export type RouterDatabaseTrigger = typeof RouterDatabaseTrigger.Type;
export const RouterDatabaseStatus = Schema.Struct({
  job: Schema.NullOr(
    Schema.Struct({
      trigger: RouterDatabaseTrigger,
      stage: RouterDatabaseStage,
      received: Integer,
      total: Count,
      /** Estimated from the transfer rate so far, or from a slow router's rate before that. */
      secondsLeft: Count,
      /** 1 for the first try; later tries follow a copy that User Manager disturbed. */
      attempt: Integer,
      startedAt: Schema.String,
    }),
  ),
  /** An automatic check waits this long to combine refresh triggers. */
  scheduledAt: Schema.NullOr(Schema.String),
  /** The last accepted copy for this customer. */
  capturedAt: Schema.NullOr(Schema.String),
  /** User Manager wrote to its database during that copy. */
  capturedBusy: Schema.Boolean,
  /** What that copy did for this customer's vouchers. */
  result: Schema.NullOr(
    Schema.Struct({
      /** Vouchers the copy matched. */
      matched: Integer,
      /** Matched vouchers nobody has used yet. */
      unused: Integer,
      /** Users the copy could not read or match to exactly one voucher. */
      skipped: Integer,
      /** Vouchers whose remaining value changed, and those still unknown after the copy. */
      changed: Count,
      unknown: Count,
    }),
  ),
  checkedAt: Schema.NullOr(Schema.String),
  outcome: Schema.Literals(["none", "accepted", "unchanged", "failed", "cancelled"]),
  failure: Schema.NullOr(
    Schema.Struct({
      stage: RouterDatabaseStage,
      reason: RouterDatabaseFailureReason,
      /** The table or column behind a layout or value failure, e.g. "customer.userName". */
      detail: Schema.NullOr(Text),
    }),
  ),
  /** Automatic copies stop until the operator fixes the failure. */
  paused: Schema.Boolean,
  /** Automatic copies wait until then after SSH was off or refused. */
  retryAt: Schema.NullOr(Schema.String),
  hostKey: Schema.NullOr(Schema.String),
  /** The new key the router presented when it no longer matched. */
  offeredHostKey: Schema.NullOr(Schema.String),
});
export type RouterDatabaseStatus = typeof RouterDatabaseStatus.Type;
/** Copies are per router; a customer narrows the status to that customer's last copy. */
export const RouterDatabaseScope = Schema.Struct({
  router: RouterProfile,
  customer: Schema.optionalKey(Name),
});
export type RouterDatabaseScope = typeof RouterDatabaseScope.Type;
const HostKey = Schema.String.check(Schema.isPattern(/^SHA256:[A-Za-z0-9+/]{43}$/));
export const RouterDatabaseTrust = Schema.Struct({
  ...RouterDatabaseScope.fields,
  hostKey: HostKey,
});
