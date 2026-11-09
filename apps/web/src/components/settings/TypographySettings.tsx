import type { ReactNode } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SettingResetButton, SettingsRow, SettingsSection } from "./appearanceLayout";
import { discoverInstalledFonts, FontFamilyPicker, useFontEnumeration } from "./FontFamilyPicker";
import { isFontFamilyAvailable, isMonospaceFamily } from "../../appearanceFonts";
import {
  DEFAULT_APPEARANCE,
  useAppearancePreferences,
  type AppearancePreferences,
} from "../../appearancePreferences";
import { useLocale } from "../../useLocale";

export function TypographySection({
  save,
}: {
  save: (update: Partial<AppearancePreferences>) => void;
}) {
  const { settings } = useAppearancePreferences();
  const { t } = useLocale();
  return (
    <SettingsSection title={t("Typography")}>
      {(["interface", "mono"] as const).map((kind) => {
        const mono = kind === "mono";
        const familyKey = mono ? "fontFamilyMono" : "fontFamilySans";
        const sizeKey = mono ? "fontSizeMono" : "fontSizeInterface";
        const title = t(mono ? "Monospace font" : "Interface font");
        return (
          <FontFamilySettingsRow
            key={kind}
            id={`setting-${mono ? "monospace-font" : "interface-font"}`}
            title={title}
            description={t(
              mono
                ? "Voucher codes, identifiers, and diagnostic output."
                : "Tables, forms, menus, and other interface text.",
            )}
            defaultFamily={t(mono ? "System monospace" : "System default")}
            defaultValue=""
            value={settings[familyKey]}
            onValueChange={(value) => save({ [familyKey]: value })}
            onReset={() => save({ [familyKey]: "", [sizeKey]: DEFAULT_APPEARANCE[sizeKey] })}
            requireMonospace={mono}
            size={{
              label: t(mono ? "Monospace font size" : "Interface font size"),
              min: mono ? 10 : 12,
              max: mono ? 18 : 20,
              value: settings[sizeKey],
              defaultValue: DEFAULT_APPEARANCE[sizeKey],
              onChange: (value) => save({ [sizeKey]: value }),
            }}
            preview={
              <div
                className={`my-3 rounded-lg border border-border/60 bg-background p-3 ${mono ? "font-mono" : "font-sans"}`}
              >
                {mono ? (
                  <pre dir="ltr">{"ABCD-1234  Il1 O0\n192.168.88.1  00:11:22:AA:BB:CC"}</pre>
                ) : (
                  <p>
                    {"Madar · User Manager · 0123456789"}
                    <br />
                    {"مدار · إدارة المستخدمين · ٠١٢٣٤٥٦٧٨٩"}
                  </p>
                )}
              </div>
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function FontFamilySettingsRow({
  id,
  title,
  description,
  defaultFamily,
  defaultValue,
  preview,
  value,
  onValueChange,
  onReset,
  requireMonospace = false,
  size,
}: {
  id?: string;
  title: string;
  description: string;
  defaultFamily: string;
  defaultValue: string;
  preview?: ReactNode;
  value: string;
  onValueChange: (value: string) => void;
  onReset: () => void;
  requireMonospace?: boolean;
  size: {
    label: string;
    min: number;
    max: number;
    value: number;
    defaultValue: number;
    onChange: (v: number) => void;
  };
}) {
  const { t } = useLocale();
  const trimmed = value.trim();
  const [draft, setDraft] = useState(value);
  const [draftSettled, setDraftSettled] = useState(true);
  // Each pending commit remembers the value it was typed against, so one that outlives
  // an external change (hydration, reset, picker selection) drops its stale draft.
  const commitTimerRef = useRef<{ readonly id: number; readonly value: string } | null>(null);
  const cancelPendingCommit = () => {
    if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current.id);
    commitTimerRef.current = null;
  };
  // Bumped on every external value change, so a pending commit typed before one never lands,
  // even if the value has since changed back to what it was typed against.
  const [adopted, setAdopted] = useState({ value, generation: 0 });
  if (adopted.value !== value) {
    setAdopted({ value, generation: adopted.generation + 1 });
    setDraft(value);
    setDraftSettled(true);
  }
  const readAdoptedGeneration = useEffectEvent(() => adopted.generation);
  useEffect(
    () => () => {
      if (commitTimerRef.current !== null) window.clearTimeout(commitTimerRef.current.id);
    },
    [],
  );
  const acceptsFamily = (candidate: string) =>
    isFontFamilyAvailable(candidate) && (!requireMonospace || isMonospaceFamily(candidate));
  const commitDraft = (next: string) => {
    setDraftSettled(true);
    if (next.trim().length === 0 || acceptsFamily(next)) {
      onValueChange(next);
    }
  };
  const flushDraft = () => {
    const pending = commitTimerRef.current;
    cancelPendingCommit();
    if (pending !== null && pending.value === value) commitDraft(draft);
  };
  const draftTrimmed = draft.trim();
  const draftPending = draftSettled && draftTrimmed.length > 0 && draftTrimmed !== trimmed;
  const resetToDefault = () => {
    cancelPendingCommit();
    setDraft(defaultValue);
    setDraftSettled(true);
    onReset();
  };
  const resetAction =
    value !== defaultValue || size.value !== size.defaultValue ? (
      <SettingResetButton label={title.toLowerCase()} onClick={resetToDefault} />
    ) : null;
  const fontEnumeration = useFontEnumeration();
  const [inputFocused, setInputFocused] = useState(false);
  const familyControl =
    fontEnumeration.status === "granted" ? (
      <FontFamilyPicker
        ariaLabel={t("{name} family", { name: title })}
        defaultFamily={defaultFamily}
        selectedFamily={trimmed}
        requireMonospace={requireMonospace}
        initialOpen={inputFocused}
        onSelect={onValueChange}
      />
    ) : (
      <Input
        size="sm"
        aria-label={t("{name} family", { name: title })}
        aria-invalid={draftPending || undefined}
        autoCapitalize="off"
        autoComplete="off"
        className="min-w-0 flex-1"
        maxLength={200}
        onFocus={() => {
          setInputFocused(true);
          discoverInstalledFonts();
        }}
        onBlur={() => {
          setInputFocused(false);
          flushDraft();
        }}
        onChange={(event) => {
          const next = event.currentTarget.value;
          setDraft(next);
          setDraftSettled(false);
          cancelPendingCommit();
          const typedAgainst = value;
          const typedInGeneration = adopted.generation;
          commitTimerRef.current = {
            id: window.setTimeout(() => {
              commitTimerRef.current = null;
              if (readAdoptedGeneration() === typedInGeneration) commitDraft(next);
            }, 400),
            value: typedAgainst,
          };
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") flushDraft();
          if (event.key === "Escape") {
            // Discard uncommitted typing without closing the settings page,
            // which is what an unhandled Escape does.
            event.preventDefault();
            event.stopPropagation();
            cancelPendingCommit();
            setDraft(value);
            setDraftSettled(true);
          }
        }}
        placeholder={defaultFamily}
        spellCheck={false}
        value={draft}
      />
    );
  const control = (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="min-w-0 flex-1 sm:w-44 sm:flex-none">{familyControl}</div>
      <Select
        value={String(size.value)}
        onValueChange={(next) => {
          if (typeof next !== "string") return;
          const parsed = Number(next);
          if (Number.isInteger(parsed) && parsed >= size.min && parsed <= size.max) {
            size.onChange(parsed);
          }
        }}
      >
        <SelectTrigger size="sm" className="w-22 shrink-0" aria-label={size.label}>
          <SelectValue>{size.value} px</SelectValue>
        </SelectTrigger>
        <SelectPopup align="end" alignItemWithTrigger={false}>
          {Array.from({ length: size.max - size.min + 1 }, (_, index) => size.min + index).map(
            (px) => (
              <SelectItem hideIndicator key={px} value={String(px)}>
                {px} px
              </SelectItem>
            ),
          )}
        </SelectPopup>
      </Select>
    </div>
  );
  return (
    <SettingsRow
      {...(id !== undefined ? { id } : {})}
      title={title}
      description={description}
      resetAction={resetAction}
      control={control}
    >
      {draftPending ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t("Font unavailable or unsuitable. Your previous font is still active.")}
        </p>
      ) : null}
      {preview}
    </SettingsRow>
  );
}
