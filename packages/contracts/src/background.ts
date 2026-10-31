import * as Schema from "effect/Schema";

export const BackgroundBooleanState = Schema.Literals(["true", "false", "unknown"]);
export type BackgroundBooleanState = typeof BackgroundBooleanState.Type;

export const HostPowerThermalState = Schema.Literals([
  "unknown",
  "nominal",
  "fair",
  "serious",
  "critical",
]);
export type HostPowerThermalState = typeof HostPowerThermalState.Type;

export const HostPowerSource = Schema.Literals([
  "unknown",
  "node-macos-shell",
  "node-macos-native",
  "node-linux",
  "node-windows",
  "electron-main",
]);
export type HostPowerSource = typeof HostPowerSource.Type;

export const HostPowerSnapshot = Schema.Struct({
  source: HostPowerSource,
  idle: BackgroundBooleanState,
  idleSeconds: Schema.NullOr(Schema.Number),
  locked: BackgroundBooleanState,
  suspended: Schema.Boolean,
  onBattery: BackgroundBooleanState,
  lowPowerMode: BackgroundBooleanState,
  thermalState: HostPowerThermalState,
  stale: Schema.Boolean,
  updatedAt: Schema.DateTimeUtc,
});
export type HostPowerSnapshot = typeof HostPowerSnapshot.Type;
