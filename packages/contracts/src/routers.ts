import * as Schema from "effect/Schema";

export const RouterProfile = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  host: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9.:_-]+$/), Schema.isMaxLength(253)),
  port: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 65535 })),
  username: Schema.NonEmptyString,
  transport: Schema.Literals(["tls", "tcp"]),
  color: Schema.Literals(["blue", "green", "amber", "red", "purple"]),
  icon: Schema.Literals(["router", "building", "home"]),
  label: Schema.String,
});
export type RouterProfile = typeof RouterProfile.Type;
export const RouterProbeInput = Schema.Struct({ profile: RouterProfile, password: Schema.String });
export type RouterProbeInput = typeof RouterProbeInput.Type;
export const RouterProbeResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("connected"),
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
