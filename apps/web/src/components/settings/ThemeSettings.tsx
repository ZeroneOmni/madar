import {
  CopyIcon,
  PaintbrushIcon,
  PenLineIcon,
  PlusIcon,
  Trash2Icon,
  UploadIcon,
} from "lucide-react";
import { T3_CHAT_THEME } from "@madar/shared/themePalettes";
import { cn } from "../../lib/utils";
import {
  STANDARD_THEME_CARDS,
  getThemeCardDefinition,
  previewColorsOf,
  ThemePreviewCircles,
} from "./ThemePreviewCircles";
import { ThemeWireframe } from "./ThemeWireframe";
import { useTheme } from "../../hooks/useTheme";
import { Tooltip, TooltipTrigger, TooltipPopup, TooltipProvider } from "../ui/tooltip";
import { useLocale } from "../../useLocale";
import { randomUUID } from "../../lib/utils";
import { useEffect, useRef, useState } from "react";
import { useCustomThemes } from "../../hooks/useCustomThemes";
import { selectTheme, useThemeSelection } from "../../themeSelection";
import {
  applyThemeColorPreview,
  applyThemePalette,
  getDefaultThemeColors,
  getThemeColorsForMode,
  installCustomTheme,
  updateCustomTheme,
  removeCustomTheme,
  parseThemeFile,
  serializeThemeFile,
  THEME_COLOR_ROLES,
  GROVE_THEME,
  OCEAN_THEME,
  EMBER_THEME,
  IRIS_THEME,
  isThemeColor,
  updateThemeColorFamily,
  type ThemeDefinition,
  type ThemeAppearance,
} from "../../themePalette";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Dialog, DialogPopup, DialogHeader, DialogTitle, DialogPanel } from "../ui/dialog";
import { ThemeColorField } from "./ThemeColorPicker";

const MAX_BYTES = 256 * 1024;
const builtins = [T3_CHAT_THEME, GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME];
function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed. Try again.";
}
function copyOf(theme: ThemeDefinition): ThemeDefinition {
  return { ...theme, id: `custom-${randomUUID()}`, label: `${theme.label.slice(0, 40)} copy` };
}

function ThemeEditor({ theme, onClose }: { theme: ThemeDefinition; onClose: () => void }) {
  const { t } = useLocale();
  const themes = useCustomThemes();
  const [draft, setDraft] = useState(theme);
  const [mode, setMode] = useState<ThemeAppearance>(theme.appearance);
  const [error, setError] = useState<string | null>(null);
  const colors = getThemeColorsForMode(draft, mode) ?? getDefaultThemeColors(mode);
  const valid =
    draft.label.trim().length > 0 &&
    draft.label.trim().length <= 48 &&
    Object.values(draft.colors).every(isThemeColor) &&
    Object.values(draft.variants ?? {}).every((variant) =>
      Object.values(variant).every(isThemeColor),
    );
  useEffect(() => {
    applyThemeColorPreview(colors, mode);
  }, [colors, mode]);
  useEffect(
    () => () => {
      applyThemePalette("system");
    },
    [],
  );
  const save = () => {
    try {
      if (!valid) throw new Error(t("Enter a name and valid literal CSS colors before saving."));
      const canonical = parseThemeFile(JSON.parse(serializeThemeFile(draft)));
      if (themes.some((entry) => entry.id === canonical.id)) updateCustomTheme(canonical);
      else installCustomTheme(canonical);
      selectTheme(canonical.id);
      onClose();
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("Edit theme")}</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-2">
            {t("Theme name")}
            <Input
              aria-label={t("Theme name")}
              value={draft.label}
              maxLength={48}
              onChange={(event) => setDraft({ ...draft, label: event.currentTarget.value })}
            />
          </label>
          <div className="flex gap-2" role="group" aria-label={t("Preview appearance")}>
            {(["light", "dark"] as const).map((appearance) => (
              <Button
                key={appearance}
                variant={mode === appearance ? "default" : "outline"}
                onClick={() => {
                  if (!getThemeColorsForMode(draft, appearance))
                    setDraft({
                      ...draft,
                      variants: {
                        ...draft.variants,
                        [appearance]: getDefaultThemeColors(appearance),
                      },
                    });
                  setMode(appearance);
                }}
              >
                {appearance === "light" ? t("Light preview") : t("Dark preview")}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {t(
              "Preview changes throughout Madar. Save keeps your theme; Cancel restores your selected theme.",
            )}
          </p>
          <div className="grid gap-1">
            {THEME_COLOR_ROLES.filter(
              (role) =>
                role === "messageAction" ||
                role === "messageActionForeground" ||
                !/^(message|code|searchMatch|terminal)/.test(role),
            ).map((role) => (
              <ThemeColorField
                key={`${mode}-${role}`}
                role={role}
                value={colors[role]}
                onChange={(changedRole, value) => {
                  const next = isThemeColor(value)
                    ? updateThemeColorFamily(mode, colors, changedRole, value)
                    : { ...colors, [changedRole]: value };
                  setDraft(
                    mode === draft.appearance
                      ? { ...draft, colors: next }
                      : { ...draft, variants: { ...draft.variants, [mode]: next } },
                  );
                }}
              />
            ))}
          </div>
          {error ? <p role="alert">{t(error)}</p> : null}
          <div className="flex gap-2">
            <Button disabled={!valid} onClick={save}>
              {t("Save theme")}
            </Button>
            <Button variant="outline" onClick={onClose}>
              {t("Cancel")}
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function ThemeSettings() {
  const { t } = useLocale();
  const custom = useCustomThemes();
  const selection = useThemeSelection();
  const { appearanceMode, setAppearanceMode } = useTheme();
  const standard = STANDARD_THEME_CARDS[0]!;
  const cards = [standard, ...[...builtins, ...custom].map(getThemeCardDefinition)];
  const wireframeColors = (mode: ThemeAppearance) => {
    const card = cards.find((entry) => entry.id === selection[mode]) ?? standard;
    return previewColorsOf(card, mode) ?? previewColorsOf(standard, mode)!;
  };
  const [editing, setEditing] = useState<ThemeDefinition | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [json, setJson] = useState("");
  const [conflict, setConflict] = useState<ThemeDefinition | null>(null);
  const [removing, setRemoving] = useState<ThemeDefinition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [reading, setReading] = useState(false);
  const request = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const run = (action: () => void) => {
    try {
      action();
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
  };
  const closeImport = () => {
    request.current++;
    setImportOpen(false);
    setReading(false);
    setConflict(null);
  };
  const readFile = async (file: { size: number; text: () => Promise<string> }) => {
    const id = ++request.current;
    setReading(true);
    try {
      if (file.size > MAX_BYTES) throw new Error(t("Theme files must be 256 KB or smaller."));
      const text = await file.text();
      if (id !== request.current) return;
      setJson(text);
      setConflict(null);
      setError(null);
    } catch (cause) {
      if (id === request.current) setError(message(cause));
    } finally {
      if (id === request.current) setReading(false);
    }
  };
  const pickFile = async () => {
    const id = ++request.current;
    try {
      if (!window.desktopBridge?.pickThemeFiles) {
        input.current?.click();
        return;
      }
      const files = await window.desktopBridge.pickThemeFiles();
      if (id !== request.current || !files?.[0]) return;
      const file = files[0];
      await readFile({ size: file.size, text: async () => file.text });
    } catch (cause) {
      if (id === request.current) setError(message(cause));
    }
  };
  const install = (theme: ThemeDefinition, update = false) => {
    if (update) updateCustomTheme(theme);
    else installCustomTheme(theme);
    setNotice(t("{name} saved. Choose Light or Dark to use it.", { name: theme.label }));
    closeImport();
  };
  const exportTheme = async (theme: ThemeDefinition) => {
    try {
      const text = serializeThemeFile(theme);
      if (window.desktopBridge?.saveThemeFile) {
        const saved = await window.desktopBridge.saveThemeFile({ name: `${theme.id}.json`, text });
        if (saved) setNotice(t("Theme exported."));
      } else {
        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${theme.id}.json`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      setError(null);
    } catch (cause) {
      setError(message(cause));
    }
  };
  return (
    <section className="space-y-3" aria-label={t("Theme library")}>
      <h3 className="px-3 text-sm font-normal text-foreground/70 sm:px-4">{t("Color scheme")}</h3>
      <div role="group" aria-label={t("Appearance")} className="grid w-full grid-cols-3 gap-3">
        {(["system", "light", "dark"] as const).map((mode) => {
          const active = appearanceMode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-pressed={active}
              aria-label={t(mode === "system" ? "System" : mode === "light" ? "Light" : "Dark")}
              className={cn(
                "flex cursor-pointer flex-col items-stretch gap-1.5 rounded-xl border p-2 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring",
                active
                  ? "border-transparent bg-accent/30"
                  : "border-border/70 bg-card/60 hover:bg-accent/10",
              )}
              style={active ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
              onClick={() =>
                run(() => {
                  if (!setAppearanceMode(mode))
                    throw new Error(t("Could not save your appearance. Please try again."));
                })
              }
            >
              <ThemeWireframe
                className="h-[8.75rem]"
                panes={
                  mode === "system"
                    ? [
                        { clip: "left", colors: wireframeColors("light") },
                        { clip: "right", colors: wireframeColors("dark") },
                      ]
                    : [{ colors: wireframeColors(mode) }]
                }
              />
              <span
                className={cn(
                  "flex items-center justify-center text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {t(mode === "system" ? "System" : mode === "light" ? "Light" : "Dark")}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-3 px-3 pt-2 sm:px-4">
        <h3 className="text-sm font-normal text-foreground/70">{t("Themes")}</h3>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setError(null);
              setEditing({
                id: `custom-${randomUUID()}`,
                label: "My theme",
                appearance: "light",
                colors: getDefaultThemeColors("light"),
                variants: { dark: getDefaultThemeColors("dark") },
              });
            }}
          >
            <PaintbrushIcon />
            {t("Create theme")}
          </Button>
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              setJson("");
              setConflict(null);
              setError(null);
              setImportOpen(true);
            }}
          >
            <PlusIcon />
            {t("Add theme")}
          </Button>
        </div>
      </div>
      <TooltipProvider>
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2">
          {cards.map((card) => {
            const theme = [...builtins, ...custom].find((entry) => entry.id === card.id);
            const editable = theme && custom.includes(theme);
            const activeModes = (["light", "dark"] as const).filter(
              (mode) => (selection[mode] ?? "system") === (theme?.id ?? "system"),
            );
            const actions = [
              {
                label: t("Duplicate {name}", { name: card.label }),
                icon: CopyIcon,
                onClick: () => {
                  setError(null);
                  setEditing(
                    copyOf(
                      theme ?? {
                        id: "default",
                        label: card.label,
                        appearance: "light",
                        colors: getDefaultThemeColors("light"),
                        variants: { dark: getDefaultThemeColors("dark") },
                      },
                    ),
                  );
                },
              },
              ...(editable
                ? [
                    {
                      label: t("Edit {name}", { name: card.label }),
                      icon: PenLineIcon,
                      onClick: () => {
                        setError(null);
                        setEditing(theme);
                      },
                    },
                    {
                      label: t("Export {name}", { name: card.label }),
                      icon: UploadIcon,
                      onClick: () => {
                        void exportTheme(theme);
                      },
                    },
                    {
                      label: t("Remove {name}", { name: card.label }),
                      icon: Trash2Icon,
                      onClick: () => setRemoving(theme),
                    },
                  ]
                : []),
            ];
            return (
              <div
                key={card.id}
                data-theme-library-card={card.id}
                className="overflow-hidden rounded-xl border border-border/70 bg-card/60 transition-colors hover:bg-accent/10"
              >
                <ThemePreviewCircles
                  label={card.label}
                  activeModes={activeModes}
                  previews={card.previews}
                  onSelectMode={(mode) => {
                    if (mode === "system") return;
                    run(() => {
                      selectTheme(theme?.id ?? "system", mode);
                      setNotice(
                        t("{name} selected for {mode} mode.", {
                          name: card.label,
                          mode: t(mode === "light" ? "Light" : "Dark"),
                        }),
                      );
                    });
                  }}
                />
                <div className="flex items-center justify-between gap-3 px-3 pb-3 pt-1">
                  <button
                    type="button"
                    className="min-w-0 cursor-pointer truncate text-start text-sm font-medium outline-none focus-visible:underline"
                    aria-label={
                      theme ? t("Use {name}", { name: card.label }) : t("Use default theme")
                    }
                    onClick={() =>
                      run(() => {
                        selectTheme(theme?.id ?? "system");
                        setNotice(t("{name} selected.", { name: card.label }));
                      })
                    }
                  >
                    {card.label}
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    {actions.map(({ label, icon: Icon, onClick }) => (
                      <Tooltip key={label}>
                        <TooltipTrigger
                          render={
                            <Button
                              size="icon-xs"
                              variant="ghost"
                              aria-label={label}
                              onClick={onClick}
                            >
                              <Icon />
                            </Button>
                          }
                        />
                        <TooltipPopup>{label}</TooltipPopup>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </TooltipProvider>
      <p role="status" className="sr-only">
        {notice}
      </p>
      {error ? <p role="alert">{t(error)}</p> : null}
      {editing ? <ThemeEditor theme={editing} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("Remove theme?")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <p>
              {t("Remove {name}? Selected modes will use the default theme.", {
                name: removing?.label ?? "",
              })}
            </p>
            <Button
              onClick={() =>
                run(() => {
                  if (removing) removeCustomTheme(removing.id);
                  setRemoving(null);
                  setNotice(t("Theme removed."));
                })
              }
            >
              {t("Remove theme")}
            </Button>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              {t("Cancel")}
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) closeImport();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("Import theme JSON")}</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Button
              variant="outline"
              disabled={reading}
              onClick={() => {
                void pickFile();
              }}
            >
              {t("Choose JSON file")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void readFile(file);
              }}
            />
            <label className="grid gap-2">
              {t("Theme JSON")}
              <textarea
                dir="ltr"
                aria-label={t("Theme JSON")}
                className="min-h-48 rounded-lg border bg-background p-2 font-mono text-xs"
                value={json}
                onChange={(event) => {
                  setJson(event.currentTarget.value);
                  setConflict(null);
                }}
              />
            </label>
            {error ? <p role="alert">{t(error)}</p> : null}
            {conflict ? (
              <>
                <p>{t("Already installed: {name}", { name: conflict.label })}</p>
                <Button onClick={() => run(() => install(conflict, true))}>
                  {t("Update existing")}
                </Button>
                <Button variant="outline" onClick={() => run(() => install(copyOf(conflict)))}>
                  {t("Keep both")}
                </Button>
              </>
            ) : (
              <Button
                disabled={reading || !json.trim()}
                onClick={() =>
                  run(() => {
                    if (new TextEncoder().encode(json).length > MAX_BYTES)
                      throw new Error(t("Theme files must be 256 KB or smaller."));
                    const theme = parseThemeFile(JSON.parse(json));
                    if (custom.some((entry) => entry.id === theme.id)) setConflict(theme);
                    else install(theme);
                  })
                }
              >
                {t("Import theme")}
              </Button>
            )}
            <Button variant="outline" onClick={closeImport}>
              {t("Cancel")}
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
