import * as Schema from "effect/Schema";

const RouterPort = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 65535 }),
);
const RouterTransport = Schema.Literals(["tls", "tcp"]);
export const RouterProfile = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  host: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9.:_-]+$/), Schema.isMaxLength(253)),
  port: RouterPort,
  username: Schema.NonEmptyString,
  transport: RouterTransport,
  tlsCertificate: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(16384))),
  color: Schema.Literals(["blue", "green", "amber", "red", "purple"]),
  icon: Schema.Literals(["router", "building", "home"]),
  label: Schema.String,
});
export type RouterProfile = typeof RouterProfile.Type;
export const RouterProbeInput = Schema.Struct({ profile: RouterProfile, password: Schema.String });
export type RouterProbeInput = typeof RouterProbeInput.Type;

export const RouterCredentialRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("get"), profile: RouterProfile }),
  Schema.Struct({ kind: Schema.Literal("set"), ...RouterProbeInput.fields }),
  Schema.Struct({ kind: Schema.Literal("remove"), profileId: Schema.NonEmptyString }),
]);
export type RouterCredentialRequest = typeof RouterCredentialRequest.Type;
export const RouterProbeResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("connected"),
    service: Schema.Literal("router-api"),
    identity: Schema.String,
    version: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    reason: Schema.Literals([
      "network",
      "tls",
      "timeout",
      "authentication",
      "permission",
      "protocol",
      "unsupported",
    ]),
  }),
]);
export type RouterProbeResult = typeof RouterProbeResult.Type;

export const RouterDisconnectInput = Schema.Struct({ profileId: Schema.NonEmptyString });
export const RouterDisconnectResult = Schema.Struct({ disconnected: Schema.Boolean });

export const DiscoveredRouter = Schema.Struct({
  host: Schema.NullOr(Schema.String),
  mac: Schema.String,
  identity: Schema.String,
  version: Schema.String,
  board: Schema.String,
});
export type DiscoveredRouter = typeof DiscoveredRouter.Type;
export const RouterDiscoveryResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("complete"), routers: Schema.Array(DiscoveredRouter) }),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    reason: Schema.Literals(["busy", "unavailable", "no-network"]),
  }),
]);
export type RouterDiscoveryResult = typeof RouterDiscoveryResult.Type;

export const RouterSecureRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("inspect"), profile: RouterProfile, sshPort: RouterPort }),
  Schema.Struct({
    kind: Schema.Literal("configure"),
    ...RouterProbeInput.fields,
    sshPort: RouterPort,
    hostKey: Schema.String.check(Schema.isPattern(/^SHA256:[A-Za-z0-9+/]{43}$/)),
  }),
  Schema.Struct({ kind: Schema.Literal("instructions"), profile: RouterProfile }),
  Schema.Struct({
    kind: Schema.Literal("verify"),
    ...RouterProbeInput.fields,
    port: RouterPort,
    fingerprint: Schema.String.check(Schema.isPattern(/^[a-fA-F0-9: -]{40,100}$/)),
  }),
]);
export type RouterSecureRequest = typeof RouterSecureRequest.Type;
export const RouterSecureResult = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("host-key"), fingerprint: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("instructions"), script: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("ready"), profile: RouterProfile }),
  Schema.Struct({
    kind: Schema.Literal("failed"),
    reason: Schema.Literals([
      "network",
      "authentication",
      "host-key",
      "permission",
      "unsupported",
      "certificate",
      "api",
      "setup",
      "busy",
    ]),
  }),
]);
export type RouterSecureResult = typeof RouterSecureResult.Type;
