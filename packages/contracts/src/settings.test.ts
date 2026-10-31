import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { ClientSettingsSchema, ServerSettings, ServerSettingsPatch } from "./settings.ts";
const decodeClientSettings = Schema.decodeUnknownSync(ClientSettingsSchema);
const encodeClientSettings = Schema.encodeSync(ClientSettingsSchema);
const decodeServerSettings = Schema.decodeUnknownSync(ServerSettings);
const decodeServerSettingsPatch = Schema.decodeUnknownSync(ServerSettingsPatch);
const encodeServerSettings = Schema.encodeSync(ServerSettings);

describe("ClientSettings retired notification preferences", () => {
  it("omits notification preferences from stored settings", () => {
    const parsed = decodeClientSettings({
      notificationMode: "notifications-and-sound",
      inAppNotificationsEnabled: true,
    });
    expect(parsed).not.toHaveProperty("notificationMode");
    expect(parsed).not.toHaveProperty("inAppNotificationsEnabled");
  });
});

describe("ClientSettings quit confirmation", () => {
  it.each([
    [true, "hold"],
    [false, "direct"],
  ] as const)("migrates the legacy %s value to %s", (legacyValue, mode) => {
    const settings = decodeClientSettings({ confirmQuit: legacyValue });

    expect(settings.confirmQuit).toBe(mode);
    expect(encodeClientSettings(settings).confirmQuit).toBe(mode);
  });
});

describe("ServerSettings retained preferences", () => {
  it("preserves theme publication and observability values through storage", () => {
    const parsed = decodeServerSettings({
      defaultTheme: "ocean",
      defaultThemeSetAt: "2026-10-31T00:00:00.000Z",
      observability: { otlpTracesUrl: "  https://collector.example.com/v1/traces  " },
    });
    expect(encodeServerSettings(parsed)).toEqual({
      defaultTheme: "ocean",
      defaultThemeSetAt: "2026-10-31T00:00:00.000Z",
      observability: {
        otlpTracesUrl: "https://collector.example.com/v1/traces",
        otlpMetricsUrl: "",
        otlpLogsUrl: "",
      },
    });
  });

  it("keeps observability patches partial", () => {
    expect(
      decodeServerSettingsPatch({ observability: { otlpLogsUrl: "  https://logs.example.com  " } }),
    ).toEqual({ observability: { otlpLogsUrl: "https://logs.example.com" } });
  });
});
