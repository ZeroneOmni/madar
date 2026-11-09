import { useState, type CSSProperties } from "react";
import {
  DEFAULT_APPEARANCE,
  saveAppearance,
  useAppearancePreferences,
  type AppearancePreferences,
} from "../../appearancePreferences";
import { useLocale } from "../../useLocale";
import { Button } from "../ui/button";
import { ThemeSettings } from "./ThemeSettings";
import { SettingsSection, SettingsRow, SettingResetButton } from "./appearanceLayout";
import { TypographySection } from "./TypographySettings";
import { PanelAnimationsPreview } from "./PanelAnimationsPreview";

const sliders = [
  {
    key: "appearanceContrast",
    id: "contrast",
    title: "Contrast",
    description: "Adjust the contrast of colors and borders across the interface.",
    min: 50,
    max: 200,
    step: 5,
    unit: "%",
  },
  {
    key: "glassOpacity",
    id: "glass-opacity",
    title: "Glass opacity",
    description: "Higher values make menus and dialogs more solid.",
    min: 40,
    max: 100,
    step: 5,
    unit: "%",
  },
  {
    key: "panelAnimationDurationMs",
    id: "panel-animations",
    title: "Panel animations",
    description: "Set how fast panels open and close.",
    min: 0,
    max: 400,
    step: 25,
    unit: " ms",
  },
] as const;

export function AppearanceSettingsPanel() {
  const { t } = useLocale();
  const { settings, error } = useAppearancePreferences();
  const [failed, setFailed] = useState(false);
  const save = (update: Partial<AppearancePreferences>) => setFailed(!saveAppearance(update));
  const row = (slider: (typeof sliders)[number]) => {
    const value = settings[slider.key];
    const ratio = (value - slider.min) / (slider.max - slider.min);
    const style = {
      "--settings-slider-progress": `${ratio * 100}%`,
      "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
    } as CSSProperties;
    const control = (
      <div className="flex w-full items-center gap-3 sm:w-52" dir="ltr">
        <output
          className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
          htmlFor={slider.id}
        >
          {value}
          {slider.unit}
        </output>
        <input
          aria-label={t(
            slider.key === "panelAnimationDurationMs" ? "Panel animation duration" : slider.title,
          )}
          className="settings-slider min-w-0 flex-1"
          id={slider.id}
          min={slider.min}
          max={slider.max}
          step={slider.step}
          style={style}
          type="range"
          value={value}
          onChange={(event) => save({ [slider.key]: Number(event.currentTarget.value) })}
        />
      </div>
    );
    return (
      <SettingsRow
        key={slider.key}
        id={`setting-${slider.id}`}
        title={t(slider.title)}
        description={t(slider.description)}
        resetAction={
          value !== DEFAULT_APPEARANCE[slider.key] ? (
            <SettingResetButton
              label={t(slider.title)}
              onClick={() => save({ [slider.key]: DEFAULT_APPEARANCE[slider.key] })}
            />
          ) : null
        }
        control={
          slider.key === "panelAnimationDurationMs" ? (
            <div className="grid w-full grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 sm:w-auto sm:grid-cols-[7rem_13rem] sm:gap-4">
              <PanelAnimationsPreview durationMs={value} />
              {control}
            </div>
          ) : (
            control
          )
        }
      />
    );
  };
  return (
    <div className="space-y-8">
      <ThemeSettings />
      {error ? (
        <div role="alert" className="space-y-3">
          <p>{t("Could not read appearance preferences. Restore defaults to recover.")}</p>
          <Button variant="outline" onClick={() => setFailed(!saveAppearance({}, true))}>
            {t("Restore appearance defaults")}
          </Button>
        </div>
      ) : null}
      <fieldset disabled={error} className="min-w-0 space-y-8">
        <SettingsSection title={t("Interface")}>{sliders.slice(0, 2).map(row)}</SettingsSection>
        <SettingsSection title={t("Motion")}>{row(sliders[2])}</SettingsSection>
        <TypographySection save={save} />
      </fieldset>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("Could not save appearance preferences. Your previous settings are still active.")}
        </p>
      ) : null}
    </div>
  );
}
