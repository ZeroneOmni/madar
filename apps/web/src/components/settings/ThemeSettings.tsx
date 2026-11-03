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
const builtins = [GROVE_THEME, OCEAN_THEME, EMBER_THEME, IRIS_THEME];
function message(error: unknown) {
  return error instanceof Error ? error.message : "The operation failed. Try again.";
}
function copyOf(theme: ThemeDefinition): ThemeDefinition {
  return { ...theme, id: `custom-${randomUUID()}`, label: `${theme.label.slice(0, 40)} copy` };
}

function ThemeEditor({ theme, onClose }: { theme: ThemeDefinition; onClose: () => void }) {
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
      if (!valid) throw new Error("Enter a name and valid literal CSS colors before saving.");
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
          <DialogTitle>Edit theme</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <label className="grid gap-2">
            Theme name
            <Input
              aria-label="Theme name"
              value={draft.label}
              maxLength={48}
              onChange={(event) => setDraft({ ...draft, label: event.currentTarget.value })}
            />
          </label>
          <div className="flex gap-2" role="group" aria-label="Preview appearance">
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
                {appearance === "light" ? "Light preview" : "Dark preview"}
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Preview changes throughout Madar. Save keeps your theme; Cancel restores your selected
            theme.
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
          {error ? <p role="alert">{error}</p> : null}
          <div className="flex gap-2">
            <Button disabled={!valid} onClick={save}>
              Save theme
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

export function ThemeSettings() {
  const custom = useCustomThemes();
  const selection = useThemeSelection();
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
      if (file.size > MAX_BYTES) throw new Error("Theme files must be 256 KB or smaller.");
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
    setNotice(`${theme.label} saved. Choose Light or Dark to use it.`);
    closeImport();
  };
  const exportTheme = async (theme: ThemeDefinition) => {
    try {
      const text = serializeThemeFile(theme);
      if (window.desktopBridge?.saveThemeFile) {
        const saved = await window.desktopBridge.saveThemeFile({ name: `${theme.id}.json`, text });
        if (saved) setNotice("Theme exported.");
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
    <section className="space-y-4" aria-label="Theme library">
      <h3 className="font-medium">Themes</h3>
      <div className="flex flex-wrap gap-2">
        <Button
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
          Create theme
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setJson("");
            setConflict(null);
            setError(null);
            setImportOpen(true);
          }}
        >
          Import theme JSON
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            run(() => {
              selectTheme("system");
              setNotice("Default theme selected.");
            })
          }
        >
          Use default theme
        </Button>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {notice}
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {[...builtins, ...custom].map((theme) => (
        <div key={theme.id} className="space-y-2 rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="size-5 rounded-full" style={{ background: theme.colors.accent }} />
            <strong>{theme.label}</strong>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["light", "dark"] as const)
              .filter((mode) => getThemeColorsForMode(theme, mode))
              .map((mode) => (
                <Button
                  key={mode}
                  variant={selection[mode] === theme.id ? "default" : "outline"}
                  aria-pressed={selection[mode] === theme.id}
                  onClick={() =>
                    run(() => {
                      selectTheme(theme.id, mode);
                      setNotice(`${theme.label} selected for ${mode} mode.`);
                    })
                  }
                >
                  Use {theme.label} for {mode}
                </Button>
              ))}
            <Button
              variant="outline"
              onClick={() => {
                setError(null);
                setEditing(custom.includes(theme) ? theme : copyOf(theme));
              }}
            >
              {custom.includes(theme) ? `Edit ${theme.label}` : `Customize ${theme.label}`}
            </Button>
            {custom.includes(theme) ? (
              <>
                <Button variant="outline" onClick={() => setEditing(copyOf(theme))}>
                  Duplicate {theme.label}
                </Button>
                <Button variant="outline" onClick={() => setRemoving(theme)}>
                  Remove {theme.label}
                </Button>
              </>
            ) : null}
            <Button
              variant="outline"
              onClick={() => {
                void exportTheme(
                  custom.includes(theme) ? theme : { ...theme, id: `${theme.id}-custom` },
                );
              }}
            >
              Export {theme.label}
            </Button>
          </div>
        </div>
      ))}
      {editing ? <ThemeEditor theme={editing} onClose={() => setEditing(null)} /> : null}
      <Dialog
        open={removing !== null}
        onOpenChange={(open) => {
          if (!open) setRemoving(null);
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Remove theme?</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <p>Remove {removing?.label}? Selected modes will use the default theme.</p>
            <Button
              onClick={() =>
                run(() => {
                  if (removing) removeCustomTheme(removing.id);
                  setRemoving(null);
                  setNotice("Theme removed.");
                })
              }
            >
              Remove theme
            </Button>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
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
            <DialogTitle>Import theme JSON</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <Button
              variant="outline"
              disabled={reading}
              onClick={() => {
                void pickFile();
              }}
            >
              Choose JSON file
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
              Theme JSON
              <textarea
                aria-label="Theme JSON"
                className="min-h-48 rounded-lg border bg-background p-2 font-mono text-xs"
                value={json}
                onChange={(event) => {
                  setJson(event.currentTarget.value);
                  setConflict(null);
                }}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            {conflict ? (
              <>
                <p>Already installed: {conflict.label}</p>
                <Button onClick={() => run(() => install(conflict, true))}>Update existing</Button>
                <Button variant="outline" onClick={() => run(() => install(copyOf(conflict)))}>
                  Keep both
                </Button>
              </>
            ) : (
              <Button
                disabled={reading || !json.trim()}
                onClick={() =>
                  run(() => {
                    if (new TextEncoder().encode(json).length > MAX_BYTES)
                      throw new Error("Theme files must be 256 KB or smaller.");
                    const theme = parseThemeFile(JSON.parse(json));
                    if (custom.some((entry) => entry.id === theme.id)) setConflict(theme);
                    else install(theme);
                  })
                }
              >
                Import theme
              </Button>
            )}
            <Button variant="outline" onClick={closeImport}>
              Cancel
            </Button>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
