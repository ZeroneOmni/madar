import { useState, useSyncExternalStore } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  DEFAULT_SHORTCUTS,
  decodeShortcuts,
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
function ShortcutEditor({
  command,
  current,
  shortcuts,
  onSaved,
}: {
  command: ShellCommandId;
  current: string;
  shortcuts: ShellShortcuts;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(current);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  function save(value: string) {
    try {
      saveShortcuts({ ...shortcuts, [command]: value.trim() });
      setDraft(value.trim());
      setError("");
      setMessage("Saved.");
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the shortcut. Try again.");
      setMessage("");
    }
  }
  return (
    <form
      aria-label={`Shortcut ${COMMAND_LABELS[command]}`}
      onSubmit={(event) => {
        event.preventDefault();
        save(draft);
      }}
      className="space-y-2 border-b py-4"
    >
      <label htmlFor={`shortcut-${command}`} className="text-sm font-medium">
        {COMMAND_LABELS[command]}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-52">
          <Input
            id={`shortcut-${command}`}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setMessage("");
            }}
            placeholder="Unassigned"
            aria-invalid={!!error}
            aria-describedby={error ? `shortcut-error-${command}` : undefined}
          />
        </div>
        <Button type="submit" variant="outline">
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={() => save("")}>
          Remove
        </Button>
        <Button type="button" variant="ghost" onClick={() => save(DEFAULT_SHORTCUTS[command])}>
          Reset
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {current === DEFAULT_SHORTCUTS[command] ? "Default" : "Custom"} · Active:{" "}
        {current || "Unassigned"}
      </p>
      {error ? (
        <p id={`shortcut-error-${command}`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      ) : null}
    </form>
  );
}
export function ShortcutSettings() {
  const { shortcuts, error } = useShellShortcuts();
  const [resetError, setResetError] = useState("");
  const [status, setStatus] = useState("");
  return (
    <section aria-label="Keyboard shortcuts" className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Use Mod for Command on macOS or Control on Windows and Linux, for example Mod+Shift+H.
        Shortcuts for navigation pause while typing. Desktop menu accelerators remain available.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button
        variant="outline"
        onClick={() => {
          try {
            saveShortcuts({ ...DEFAULT_SHORTCUTS });
            setStatus("Default shortcuts restored.");
            setResetError("");
          } catch {
            setResetError("Could not reset shortcuts. Try again.");
          }
        }}
      >
        Reset all shortcuts
      </Button>
      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
      {resetError ? (
        <p role="alert" className="text-sm text-destructive">
          {resetError}
        </p>
      ) : null}
      {(Object.keys(COMMAND_LABELS) as ShellCommandId[]).map((command) => (
        <ShortcutEditor
          key={`${command}:${shortcuts[command]}`}
          command={command}
          current={shortcuts[command]}
          shortcuts={shortcuts}
          onSaved={() => setStatus("Shortcut saved.")}
        />
      ))}
    </section>
  );
}
