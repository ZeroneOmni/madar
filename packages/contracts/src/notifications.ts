import * as Schema from "effect/Schema";

export const DesktopNotificationInput = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160)),
  message: Schema.String.check(Schema.isMaxLength(2000)),
  path: Schema.String.check(Schema.isPattern(/^\/[a-z0-9/-]*$/)),
});
export type DesktopNotificationInput = typeof DesktopNotificationInput.Type;
export const DesktopNotificationResult = Schema.Struct({
  status: Schema.Literals(["shown", "suppressed", "unsupported", "failed"]),
  message: Schema.optionalKey(Schema.String),
});
export type DesktopNotificationResult = typeof DesktopNotificationResult.Type;
