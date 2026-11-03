import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "../components/ui/command";
import { useStableCallback } from "../hooks/useStableCallback";
import { isMacPlatform } from "../lib/utils";
import { COMMAND_LABELS, useShellShortcuts } from "./shortcuts";
import { matchesShortcut, shortcutAllowedInEditor, type ShellCommandId } from "./shortcuts.logic";
const PATHS = {
  settings: "/settings/general",
  overview: "/overview",
  vouchers: "/vouchers",
  subscriptions: "/subscriptions",
  designs: "/card-designs",
  usage: "/usage",
  notifications: "/notifications",
  welcome: "/welcome",
} as const;
export function useShellCommands({
  onNavigate,
  onToggleSidebar,
}: {
  onNavigate: (path: string) => void;
  onToggleSidebar: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { shortcuts, error } = useShellShortcuts();
  const execute = useStableCallback((command: ShellCommandId) => {
    if (command === "palette") {
      setOpen((current) => !current);
      return;
    }
    setOpen(false);
    if (command === "sidebar") onToggleSidebar();
    else onNavigate(PATHS[command]);
  });
  const onKeyDown = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    const target = event.target;
    const editable =
      target instanceof Element &&
      !!target.closest(
        "input,textarea,select,[contenteditable]:not([contenteditable='false']),[role='textbox']",
      );
    for (const command of Object.keys(COMMAND_LABELS) as ShellCommandId[]) {
      if (editable && !shortcutAllowedInEditor(command)) continue;
      if (command === "sidebar" && window.getSelection()?.toString()) continue;
      if (!matchesShortcut(event, shortcuts[command], isMacPlatform(navigator.platform))) continue;
      event.preventDefault();
      execute(command);
      return;
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);
  const commands = (Object.keys(COMMAND_LABELS) as ShellCommandId[])
    .filter((id) => id !== "palette")
    .map((id) => ({ id, label: COMMAND_LABELS[id] }));
  return { open, setOpen, commands, execute, shortcuts, error };
}
type CommandState = ReturnType<typeof useShellCommands>;
export function CommandMenu({
  open,
  setOpen,
  commands,
  execute,
  shortcuts,
}: Pick<CommandState, "open" | "setOpen" | "commands" | "execute" | "shortcuts">) {
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandDialogPopup>
        <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
        <CommandResults
          key={String(open)}
          commands={commands}
          execute={execute}
          shortcuts={shortcuts}
        />
      </CommandDialogPopup>
    </CommandDialog>
  );
}
function CommandResults({
  commands,
  execute,
  shortcuts,
}: Pick<CommandState, "commands" | "execute" | "shortcuts">) {
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const filtered = commands.filter((command) =>
    command.label.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    <Command
      mode="none"
      items={filtered.map((command) => command.id)}
      value={query}
      onValueChange={setQuery}
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
    >
      <CommandInput
        aria-label="Search commands"
        placeholder="Search commands…"
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          const selected = filtered.find((command) => command.id === highlighted) ?? filtered[0];
          if (selected) {
            event.preventDefault();
            execute(selected.id);
          }
        }}
      />
      <CommandPanel>
        {filtered.length ? (
          <CommandList>
            {filtered.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => execute(command.id)}
              >
                <span>{command.label}</span>
                <CommandShortcut>{shortcuts[command.id]}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandList>
        ) : (
          <p role="status" className="p-8 text-center text-sm text-muted-foreground">
            No matching commands.
          </p>
        )}
      </CommandPanel>
    </Command>
  );
}
