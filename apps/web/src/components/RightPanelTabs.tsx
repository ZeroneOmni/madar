import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { restrictToFirstScrollableAncestor, restrictToHorizontalAxis } from "@dnd-kit/modifiers";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ContextMenuItem } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { resolveShortcutCommand } from "~/keybindings";
import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { isModelPickerOpen } from "~/modelPickerVisibility";
import { isEditableFocused } from "~/lib/editableFocus";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import type { EnvironmentId, ResolvedKeybindingsConfig } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { Files, Plus, Smartphone } from "lucide-react";
import type { RightPanelSurface } from "~/rightPanelStore";
import type { PreviewPanelInlineSize } from "~/hooks/usePreviewPanelInlineSize";
import { Button } from "./ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./ui/menu";
import { PanelTabCloseButton } from "./ui/panel-tab-close-button";
import { ScrollArea } from "./ui/scroll-area";
import { PreviewPanelShell, type PreviewPanelMode } from "./preview/PreviewPanelShell";
export interface RightPanelTabsProps {
  mode: PreviewPanelMode;
  maximized?: boolean | undefined;
  open?: boolean | undefined;
  keybindings: ResolvedKeybindingsConfig;
  widthStorageKey?: string | undefined;
  defaultWidth?: number | undefined;
  inlineSize?: PreviewPanelInlineSize | undefined;
  layoutControls?: ReactNode | undefined;
  surfaces: readonly RightPanelSurface[];
  environmentId: EnvironmentId | null;
  activeSurfaceId: string | null;
  pendingSurfaceIds: ReadonlySet<string>;
  onActivate: (surface: RightPanelSurface) => void;
  onRenameDevice?: ((surfaceId: string, title: string) => void) | undefined;
  onCloseSurface: (surface: RightPanelSurface) => void;
  onCloseOtherSurfaces: (surface: RightPanelSurface) => void;
  onCloseSurfacesToRight: (surface: RightPanelSurface) => void;
  onCloseAllSurfaces: () => void;
  onMoveSurface?: ((surfaceId: string, toIndex: number) => void) | undefined;
  onCopyFilePath: (relativePath: string) => void;
  onAddFiles: () => void;
  onAddDevice: () => void;
  filesAvailable: boolean;
  deviceAvailable: boolean;
  children: ReactNode;
}
function surfaceLabel(surface: RightPanelSurface) {
  switch (surface.kind) {
    case "files":
      return "Files";
    case "file":
      return surface.attachment?.name ?? surface.relativePath.split(/[\\/]/).at(-1) ?? "File";
    case "device":
      return surface.title ?? surface.target?.name ?? "Device";
    default:
      return "Panel";
  }
}
const TAB_DRAG_MODIFIERS = [restrictToHorizontalAxis, restrictToFirstScrollableAncestor];
function RightPanelTab({
  surface,
  props,
}: {
  surface: RightPanelSurface;
  props: RightPanelTabsProps;
}) {
  const [renaming, setRenaming] = useState(false);
  const tabRef = useRef<HTMLDivElement>(null);
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: surface.id,
    disabled: props.onMoveSurface === undefined,
  });
  const active = surface.id === props.activeSurfaceId;
  useLayoutEffect(() => {
    if (active) tabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active]);
  const title = surfaceLabel(surface);
  const contextMenu = async (position: { x: number; y: number }) => {
    const api = readLocalApi();
    if (!api) return;
    const index = props.surfaces.findIndex((entry) => entry.id === surface.id);
    const items: ContextMenuItem[] = [];
    if (surface.kind === "device" && props.onRenameDevice)
      items.push({ id: "rename", label: "Rename" });
    if (surface.kind === "file" && !surface.attachment)
      items.push({ id: "copy", label: "Copy path" });
    items.push(
      { id: "close", label: "Close" },
      { id: "others", label: "Close others", disabled: props.surfaces.length <= 1 },
      { id: "right", label: "Close to the right", disabled: index === props.surfaces.length - 1 },
      { id: "all", label: "Close all" },
    );
    switch (await api.contextMenu.show(items, position)) {
      case "rename":
        setRenaming(true);
        break;
      case "copy":
        if (surface.kind === "file") props.onCopyFilePath(surface.relativePath);
        break;
      case "close":
        props.onCloseSurface(surface);
        break;
      case "others":
        props.onCloseOtherSurfaces(surface);
        break;
      case "right":
        props.onCloseSurfacesToRight(surface);
        break;
      case "all":
        props.onCloseAllSurfaces();
        break;
    }
  };
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        tabRef.current = node;
      }}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "group/tab flex h-7 max-w-48 shrink-0 items-center gap-1 rounded-md px-2 text-xs [-webkit-app-region:no-drag]",
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
        isDragging && "relative z-10",
      )}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onMouseUp={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button === 1) {
          event.preventDefault();
          props.onCloseSurface(surface);
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        void contextMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <PanelTabCloseButton label={"Close " + title} onClick={() => props.onCloseSurface(surface)}>
        {surface.kind === "device" ? (
          <Smartphone className="size-3" />
        ) : (
          <Files className="size-3" />
        )}
      </PanelTabCloseButton>
      {renaming ? (
        <input
          aria-label="Device tab name"
          className="w-24 min-w-0 rounded-sm bg-background px-1 outline-none ring-1 ring-ring"
          defaultValue={title}
          ref={(node) => {
            node?.focus();
            node?.select();
          }}
          onBlur={(event) => {
            props.onRenameDevice?.(surface.id, event.currentTarget.value);
            setRenaming(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") event.currentTarget.value = title;
            if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
          }}
        />
      ) : (
        <button
          type="button"
          role="tab"
          aria-selected={active}
          className="min-w-0 truncate py-1"
          onClick={() => props.onActivate(surface)}
          onDoubleClick={() => {
            if (surface.kind === "device" && props.onRenameDevice) setRenaming(true);
          }}
        >
          {title}
        </button>
      )}
      {props.pendingSurfaceIds.has(surface.id) ? (
        <span className="size-1.5 rounded-full bg-current" aria-label="Loading" />
      ) : null}
    </div>
  );
}
export function RightPanelTabs(props: RightPanelTabsProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [menuOpen, setMenuOpen] = useState(false);
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      isCommandPaletteOpen() ||
      isModelPickerOpen()
    )
      return;
    if (
      resolveShortcutCommand(event, props.keybindings, {
        context: { rightPanelOpen: true, editableFocus: isEditableFocused(event.target) },
      }) !== "rightPanel.new"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) setMenuOpen(true);
  });
  useEffect(() => {
    if (props.open === false) return;
    const listener = (event: KeyboardEvent) => handleShortcut(event);
    document.addEventListener("keydown", listener, true);
    return () => document.removeEventListener("keydown", listener, true);
  }, [props.open]);
  return (
    <PreviewPanelShell
      mode={props.mode}
      {...(props.maximized === undefined
        ? {}
        : {
            maximized: props.maximized,
          })}
      {...(props.open === undefined
        ? {}
        : {
            open: props.open,
          })}
      {...(props.widthStorageKey === undefined
        ? {}
        : {
            widthStorageKey: props.widthStorageKey,
          })}
      {...(props.defaultWidth === undefined
        ? {}
        : {
            defaultWidth: props.defaultWidth,
          })}
      {...(props.inlineSize === undefined
        ? {}
        : {
            inlineSize: props.inlineSize,
          })}
    >
      <div className="flex h-10 shrink-0 items-center border-b border-border">
        <ScrollArea className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center" role="tablist" aria-label="Workspace panels">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={TAB_DRAG_MODIFIERS}
              onDragEnd={({ active, over }) => {
                if (!over || active.id === over.id) return;
                const index = props.surfaces.findIndex((surface) => surface.id === over.id);
                if (index >= 0) props.onMoveSurface?.(String(active.id), index);
              }}
            >
              <SortableContext
                items={props.surfaces.map((surface) => surface.id)}
                strategy={horizontalListSortingStrategy}
              >
                {props.surfaces.map((surface) => (
                  <RightPanelTab key={surface.id} surface={surface} props={props} />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </ScrollArea>
        <Menu open={menuOpen} onOpenChange={setMenuOpen}>
          <MenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label="Add panel">
                <Plus className="size-3.5" />
              </Button>
            }
          />
          <MenuPopup align="end">
            <MenuItem disabled={!props.filesAvailable} onClick={props.onAddFiles}>
              <Files className="size-3.5" /> Files
            </MenuItem>
            <MenuItem disabled={!props.deviceAvailable} onClick={props.onAddDevice}>
              <Smartphone className="size-3.5" /> Device
            </MenuItem>
            <MenuItem disabled={props.surfaces.length === 0} onClick={props.onCloseAllSurfaces}>
              Close all panels
            </MenuItem>
          </MenuPopup>
        </Menu>
        {props.layoutControls}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{props.children}</div>
    </PreviewPanelShell>
  );
}

interface SurfaceShortcutEvent {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly defaultPrevented: boolean;
  readonly isComposing: boolean;
}
export function surfaceShortcutActionForKey<
  const Action extends { available: boolean; shortcut: string },
>(actions: readonly Action[], event: SurfaceShortcutEvent): Action | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  return (
    actions.find(
      (action) => action.available && action.shortcut.toLowerCase() === event.key.toLowerCase(),
    ) ?? null
  );
}

export function surfaceShortcutTargetsTypingContext(
  target: { closest(selectors: string): unknown } | null,
): boolean {
  return (
    target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') !=
    null
  );
}
