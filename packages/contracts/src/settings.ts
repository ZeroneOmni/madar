import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { TrimmedString } from "./baseSchemas.ts";

export const QuitConfirmationMode = Schema.Literals(["direct", "hold", "double-click"]);
export type QuitConfirmationMode = typeof QuitConfirmationMode.Type;
const DEFAULT_QUIT_CONFIRMATION_MODE: QuitConfirmationMode = "hold";

const LegacyConfirmQuit = Schema.Boolean.pipe(
  Schema.decodeTo(
    QuitConfirmationMode,
    SchemaTransformation.transform({
      decode: (confirmQuit): QuitConfirmationMode => (confirmQuit ? "hold" : "direct"),
      encode: (mode) => mode === "hold",
    }),
  ),
);

const QuitConfirmationModeSetting = Schema.Union([QuitConfirmationMode, LegacyConfirmQuit]);

export const ClientSettingsSchema = Schema.Struct({
  confirmQuit: QuitConfirmationModeSetting.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_QUIT_CONFIRMATION_MODE)),
  ),
});
export type ClientSettings = typeof ClientSettingsSchema.Type;

export const DEFAULT_CLIENT_SETTINGS: ClientSettings = Schema.decodeSync(ClientSettingsSchema)({});

export const ObservabilitySettings = Schema.Struct({
  otlpTracesUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpMetricsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  otlpLogsUrl: TrimmedString.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
});
export type ObservabilitySettings = typeof ObservabilitySettings.Type;

export const ServerSettings = Schema.Struct({
  observability: ObservabilitySettings.pipe(Schema.withDecodingDefault(Effect.succeed({}))),
});
export type ServerSettings = typeof ServerSettings.Type;

export type UnifiedSettings = ServerSettings & ClientSettings;

export const ServerSettingsPatch = Schema.Struct({
  observability: Schema.optionalKey(
    Schema.Struct({
      otlpTracesUrl: Schema.optionalKey(TrimmedString),
      otlpMetricsUrl: Schema.optionalKey(TrimmedString),
      otlpLogsUrl: Schema.optionalKey(TrimmedString),
    }),
  ),
});
export type ServerSettingsPatch = typeof ServerSettingsPatch.Type;

export const ClientSettingsPatch = Schema.Struct({
  confirmQuit: Schema.optionalKey(QuitConfirmationMode),
});
export type ClientSettingsPatch = typeof ClientSettingsPatch.Type;
