import { useState, useSyncExternalStore } from "react";
import { EllipsisIcon, FileJsonIcon, PlusIcon, SearchIcon, Undo2Icon } from "lucide-react";
import { useLocale } from "../useLocale";
import { isMacPlatform } from "../lib/utils";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../components/ui/input-group";
import { Kbd, KbdGroup } from "../components/ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../components/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
} from "../components/ui/dialog";
import { Textarea } from "../components/ui/textarea";
import { SettingsSection } from "../components/settings/appearanceLayout";
import {
  DEFAULT_SHORTCUTS,
  decodeShortcuts,
  shortcutAllowedInEditor,
  shortcutFromKeyboardEvent,
  validateShortcuts,
  type ShellCommandId,
  type ShellShortcuts,
} from "./shortcuts.logic";

const STORAGE_KEY = "madar:shell-shortcuts";
const CHANGE_EVENT = "madar:shell-shortcuts-change";
const UNREADABLE = "unreadable";
export const COMMAND_LABELS: Record<ShellCommandId, string> = {
  palette: "Open command palette",
  settings: "Open Settings",
  sidebar: "Toggle sidebar",
  overview: "Go to overview",
  vouchers: "Go to vouchers",
  subscriptions: "Go to subscriptions",
  designs: "Go to card designs",
  usage: "Go to usage",
  notifications: "Open notifications",
  welcome: "Show welcome",
};
const COMMANDS = Object.keys(COMMAND_LABELS) as ShellCommandId[];

function read() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return UNREADABLE;
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener("storage", storage);
  window.addEventListener(CHANGE_EVENT, listener);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(CHANGE_EVENT, listener);
  };
}
function saveShortcuts(shortcuts: ShellShortcuts) {
  const validated = validateShortcuts(shortcuts);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function load(serialized: string | null) {
  try {
    return { shortcuts: decodeShortcuts(serialized), error: null };
  } catch {
    return {
      shortcuts: { ...DEFAULT_SHORTCUTS },
      error: "Saved shortcuts could not be read. Defaults are active; reset to repair them.",
    };
  }
}
export function useShellShortcuts() {
  const serialized = useSyncExternalStore(subscribe, read, () => null);
  return load(serialized);
}

function KeybindingPill({ value }: { value: string }) {
  const mac = isMacPlatform(navigator.platform);
  const labels: Record<string, string> = {
    mod: mac ? "⌘" : "Ctrl",
    ctrl: "Ctrl",
    meta: mac ? "⌘" : "Meta",
    shift: "⇧",
    alt: mac ? "⌥" : "Alt",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
  };
  return (
    <KbdGroup dir="ltr">
      {value.split("+").map((part) => (
        <Kbd key={part}>{labels[part.trim().toLowerCase()] ?? part.toUpperCase()}</Kbd>
      ))}
    </KbdGroup>
  );
}

function ShortcutEditor({
  command,
  current,
  shortcuts,
  onSaved,
  onCancel,
  startEditing = false,
}: {
  command: ShellCommandId;
  current: string;
  shortcuts: ShellShortcuts;
  onSaved: () => void;
  onCancel?: () => void;
  startEditing?: boolean;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(current);
  const [editing, setEditing] = useState(startEditing);
  const [error, setError] = useState("");
  const label = t(COMMAND_LABELS[command]);
  function save(value: string) {
    try {
      saveShortcuts({ ...shortcuts, [command]: value.trim() });
      setDraft(value.trim());
      setEditing(false);
      setError("");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the shortcut. Try again.");
    }
  }
  function cancel() {
    setDraft(current);
    setEditing(false);
    setError("");
    onCancel?.();
  }
  return (
    <form
      aria-label={t("Shortcut {name}", { name: label })}
      className="group/row space-y-2 px-3 py-3 sm:px-4"
      onSubmit={(event) => {
        event.preventDefault();
        save(draft);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">{label}</h3>
            {current !== DEFAULT_SHORTCUTS[command] && current ? (
              <span className="text-xs text-muted-foreground">{t("Custom")}</span>
            ) : null}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{t("When")}</span>
            <span>{t(shortcutAllowedInEditor(command) ? "Always" : "Not typing")}</span>
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {editing ? (
            <>
              <div className="w-44 max-w-full">
                <Input
                  autoFocus
                  dir="ltr"
                  size="sm"
                  font="mono"
                  aria-label={label}
                  aria-invalid={!!error}
                  aria-describedby={error ? `shortcut-error-${command}` : undefined}
                  value={draft}
                  placeholder={t("Press shortcut")}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Tab" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (event.key === "Escape") {
                      cancel();
                      return;
                    }
                    if (event.repeat) return;
                    const next = shortcutFromKeyboardEvent(
                      event.nativeEvent,
                      isMacPlatform(navigator.platform),
                    );
                    if (next) {
                      setDraft(next);
                      setError("");
                    }
                  }}
                />
              </div>
              <Button key="save" type="submit" size="sm" disabled={!draft.trim()}>
                {t("Save")}
              </Button>
              <Button variant="ghost" size="sm" onClick={cancel}>
                {t("Cancel")}
              </Button>
            </>
          ) : (
            <>
              <span className="opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        variant="ghost-muted"
                        size="icon-sm"
                        aria-label={t("Actions for {name}", { name: label })}
                      />
                    }
                  >
                    <EllipsisIcon aria-hidden />
                  </MenuTrigger>
                  <MenuPopup align="end">
                    <MenuItem onClick={() => setEditing(true)}>{t("Edit keybinding")}</MenuItem>
                    <MenuItem
                      disabled={current === DEFAULT_SHORTCUTS[command]}
                      onClick={() => save(DEFAULT_SHORTCUTS[command])}
                    >
                      {t("Reset to default")}
                    </MenuItem>
                    <MenuItem disabled={!current} variant="destructive" onClick={() => save("")}>
                      {t("Remove")}
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              </span>
              <Button
                variant="ghost"
                size="sm"
                key="edit"
                aria-label={t("Edit shortcut for {name}", { name: label })}
                onClick={() => setEditing(true)}
              >
                {current ? <KeybindingPill value={current} /> : <span>{t("Unassigned")}</span>}
              </Button>
            </>
          )}
        </div>
      </div>
      {editing ? (
        <p className="text-xs text-muted-foreground">
          {t("Press a key combination. Escape cancels; Tab moves to Save.")}
        </p>
      ) : null}
      {error ? (
        <p id={`shortcut-error-${command}`} role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
    </form>
  );
}

function KeybindingsJsonEditor({
  shortcuts,
  onSaved,
  onClose,
}: {
  shortcuts: ShellShortcuts;
  onSaved: () => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const [draft, setDraft] = useState(JSON.stringify(shortcuts, null, 2));
  const [error, setError] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            try {
              saveShortcuts(decodeShortcuts(draft));
              onSaved();
              onClose();
            } catch (cause) {
              setError(
                cause instanceof SyntaxError
                  ? "Enter valid JSON."
                  : cause instanceof Error
                    ? cause.message
                    : "Could not save the shortcut. Try again.",
              );
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("Edit keybindings JSON")}</DialogTitle>
            <DialogDescription>
              {t("Changes apply to shortcuts saved on this device.")}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Textarea
              dir="ltr"
              aria-label={t("Keybindings JSON")}
              aria-invalid={!!error}
              aria-describedby={error ? "keybindings-json-error" : undefined}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError("");
              }}
            />
            {error ? (
              <p id="keybindings-json-error" role="alert" className="text-sm text-destructive">
                {t(error)}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              {t("Cancel")}
            </Button>
            <Button type="submit">{t("Save")}</Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function ShortcutSettings() {
  const { t } = useLocale();
  const { shortcuts, error } = useShellShortcuts();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [command, setCommand] = useState<ShellCommandId | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [resetError, setResetError] = useState("");
  const [status, setStatus] = useState("");
  const available = COMMANDS.filter((id) => !shortcuts[id]);
  const filtered = COMMANDS.filter((id) => !(adding && id === command)).filter((id) =>
    [
      t(COMMAND_LABELS[id]),
      shortcuts[id],
      shortcuts[id].replace(/mod/gi, isMacPlatform(navigator.platform) ? "Command" : "Ctrl"),
      t(shortcutAllowedInEditor(id) ? "Always" : "Not typing"),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const saved = () => setStatus(t("Shortcut saved."));
  return (
    <section aria-label={t("Keyboard shortcuts")} className="space-y-8">
      <SettingsSection title={t("Keybindings")}>
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 sm:px-4">
          <div className="min-w-0 basis-full sm:flex-1 sm:basis-0">
            <InputGroup>
              <InputGroupAddon>
                <SearchIcon aria-hidden />
              </InputGroupAddon>
              <InputGroupInput
                size="sm"
                type="search"
                aria-label={t("Search keybindings")}
                placeholder={t("Search keybindings")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  if (query) setQuery("");
                  else event.currentTarget.blur();
                }}
              />
            </InputGroup>
          </div>
          <Button
            variant="outline"
            disabled={adding || !available.length}
            onClick={() => {
              setAdding(true);
              setCommand(available[0] ?? null);
            }}
          >
            <PlusIcon aria-hidden />
            {t("Add keybinding")}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("Edit keybindings JSON")}
            title={t("Edit keybindings JSON")}
            onClick={() => setJsonOpen(true)}
          >
            <FileJsonIcon aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Reset all shortcuts")}
            title={t("Reset all shortcuts")}
            onClick={() => {
              try {
                saveShortcuts({ ...DEFAULT_SHORTCUTS });
                setStatus(t("Default shortcuts restored."));
                setResetError("");
              } catch {
                setResetError(t("Could not reset shortcuts. Try again."));
              }
            }}
          >
            <Undo2Icon aria-hidden />
          </Button>
        </div>
      </SettingsSection>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      ) : null}
      {resetError ? (
        <p role="alert" className="text-sm text-destructive">
          {resetError}
        </p>
      ) : null}
      {adding ? (
        <SettingsSection title={t("Add keybinding")}>
          <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
            <div className="min-w-0 flex-1">
              <Select
                value={command}
                onValueChange={setCommand}
                items={available.map((id) => ({ value: id, label: t(COMMAND_LABELS[id]) }))}
              >
                <SelectTrigger aria-label={t("Command")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {available.map((id) => (
                    <SelectItem key={id} value={id}>
                      {t(COMMAND_LABELS[id])}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              {t("Cancel")}
            </Button>
          </div>
          {command && !shortcuts[command] ? (
            <ShortcutEditor
              key={command}
              command={command}
              current=""
              shortcuts={shortcuts}
              startEditing
              onCancel={() => setAdding(false)}
              onSaved={() => {
                saved();
                setAdding(false);
                setQuery("");
              }}
            />
          ) : null}
        </SettingsSection>
      ) : null}
      {filtered.length ? (
        <SettingsSection title={t("Navigation")}>
          {filtered.map((id) => (
            <ShortcutEditor
              key={`${id}:${shortcuts[id]}`}
              command={id}
              current={shortcuts[id]}
              shortcuts={shortcuts}
              onSaved={saved}
            />
          ))}
        </SettingsSection>
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("No keybindings match your search.")}
        </p>
      )}
      <p role="status" className="sr-only">
        {status}
      </p>
      <p className="text-xs text-muted-foreground">
        {t("Navigation shortcuts pause while typing. Desktop menu accelerators remain available.")}
      </p>
      {jsonOpen ? (
        <KeybindingsJsonEditor
          shortcuts={shortcuts}
          onSaved={saved}
          onClose={() => setJsonOpen(false)}
        />
      ) : null}
    </section>
  );
}
