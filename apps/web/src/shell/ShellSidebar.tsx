import { useState } from "react";
import { randomUUID } from "../lib/utils";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  ChartColumn,
  CreditCard,
  Folder,
  Home,
  Pin,
  Search,
  Settings,
  Ticket,
  Waypoints,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Dialog,
  DialogPopup,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogPanel,
  DialogFooter,
  DialogClose,
} from "../components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectPopup,
  SelectItem,
} from "../components/ui/select";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
} from "../components/ui/sidebar";
import {
  destinations,
  type DestinationId,
  type NavigationAction,
  type NavigationState,
} from "./navigation";

const icons = {
  overview: Home,
  vouchers: Ticket,
  subscriptions: Waypoints,
  "card-designs": CreditCard,
  usage: ChartColumn,
  notifications: Bell,
};

export function ShellSidebar({
  state,
  path,
  onNavigate,
  onCommand,
  onChange,
  error,
}: {
  state: NavigationState;
  path: string;
  error: string | null;
  onNavigate: (path: string) => void;
  onCommand: () => void;
  onChange: (action: NavigationAction) => boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [dragged, setDragged] = useState<DestinationId | null>(null);
  const { setOpenMobile, isMobile } = useSidebar();
  function navigate(path: string) {
    onNavigate(path);
    if (isMobile) setOpenMobile(false);
  }
  function rows(group: string, pinned = false) {
    return (
      <SidebarMenu>
        {state.items
          .filter((item) => (pinned ? item.pinned : !item.pinned && item.group === group))
          .map((item) => {
            const destination = destinations.find((d) => d.id === item.id)!;
            const Icon = icons[item.id];
            return (
              <SidebarMenuItem
                key={item.id}
                draggable
                onDragStart={(event) => {
                  setDragged(item.id);
                  event.dataTransfer.setData("text/plain", item.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => setDragged(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (dragged) onChange({ type: "move", id: dragged, before: item.id });
                  setDragged(null);
                }}
              >
                <SidebarMenuButton
                  isActive={path.split("?")[0] === "/" + item.id}
                  onClick={() => navigate("/" + item.id)}
                  aria-current={path.split("?")[0] === "/" + item.id ? "page" : undefined}
                >
                  <Icon />
                  <span>
                    {destination.label}
                    {item.pinned ? " - Pinned" : ""}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
      </SidebarMenu>
    );
  }
  return (
    <>
      <Sidebar
        resizable={{ storageKey: "madar:shell-sidebar-width", minWidth: 240, maxWidth: 420 }}
      >
        <SidebarHeader>
          <div className="flex h-11 items-center gap-2 px-2">
            <span className="font-semibold">Madar</span>
            <span className="text-xs text-muted-foreground">User Manager</span>
          </div>
          <Button variant="outline" onClick={onCommand}>
            <Search />
            Commands
          </Button>
        </SidebarHeader>
        <SidebarContent>
          <nav aria-label="Workspace" className="space-y-4 p-3">
            <section
              aria-label="Pinned"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragged) {
                  const item = state.items.find((item) => item.id === dragged);
                  if (item && !item.pinned) onChange({ type: "pin", id: dragged });
                }
                setDragged(null);
              }}
            >
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">Pinned</h2>
              {state.items.some((item) => item.pinned) ? (
                rows("", true)
              ) : (
                <p className="py-2 text-xs text-muted-foreground">
                  Pin destinations with Organize navigation.
                </p>
              )}
            </section>
            <section aria-label="Workspace destinations">
              <h2 className="mb-2 text-xs font-medium text-muted-foreground">Workspace</h2>
              {rows("")}
            </section>
            {state.groups.map((group) => (
              <section
                key={group.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (dragged) onChange({ type: "assign", id: dragged, group: group.id });
                  setDragged(null);
                }}
              >
                <div className="mb-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={!group.collapsed}
                    onClick={() => onChange({ type: "collapse-group", id: group.id })}
                  >
                    <Folder />
                    {group.name}
                  </Button>
                </div>
                {!group.collapsed ? rows(group.id) : null}
                {!group.collapsed &&
                !state.items.some((item) => item.group === group.id && !item.pinned) ? (
                  <p className="py-2 text-xs text-muted-foreground">
                    Drop a destination here or assign one in Organize navigation.
                  </p>
                ) : null}
              </section>
            ))}
          </nav>
        </SidebarContent>
        <SidebarFooter>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Organize navigation
          </Button>
          <Button variant="ghost" onClick={() => navigate("/settings/general")}>
            <Settings />
            Settings
          </Button>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Organize navigation</DialogTitle>
            <DialogDescription>
              Drag destinations in the sidebar or use these controls. Changes are saved
              automatically.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <div className="space-y-4">
              {state.items.map((item, index) => {
                const label = destinations.find((d) => d.id === item.id)!.label;
                return (
                  <section
                    key={item.id}
                    className="space-y-2 rounded-lg border p-3"
                    aria-label={label + " navigation"}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move ${label} up`}
                          disabled={index === 0}
                          onClick={() => {
                            const before = state.items[index - 1];
                            if (before)
                              onChange({
                                type: "move",
                                id: item.id,
                                before: before.id,
                                keepMembership: true,
                              });
                          }}
                        >
                          <ArrowUp />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Move ${label} down`}
                          disabled={index === state.items.length - 1}
                          onClick={() => {
                            const next = state.items[index + 1];
                            if (next)
                              onChange({
                                type: "move",
                                id: item.id,
                                before: next.id,
                                after: true,
                                keepMembership: true,
                              });
                          }}
                        >
                          <ArrowDown />
                        </Button>
                        <Button
                          variant={item.pinned ? "secondary" : "ghost"}
                          size="icon-sm"
                          aria-label={`${item.pinned ? "Unpin" : "Pin"} ${label}`}
                          aria-pressed={item.pinned}
                          onClick={() => onChange({ type: "pin", id: item.id })}
                        >
                          <Pin />
                        </Button>
                      </div>
                    </div>
                    <Select
                      value={item.group}
                      onValueChange={(group) => {
                        if (group !== null) onChange({ type: "assign", id: item.id, group });
                      }}
                    >
                      <SelectTrigger aria-label={"Group for " + label}>
                        <SelectValue>
                          {item.group
                            ? state.groups.find((group) => group.id === item.group)?.name
                            : "Workspace"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="">Workspace</SelectItem>
                        {state.groups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            {group.name}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </section>
                );
              })}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (
                  groupName.trim() &&
                  onChange({ type: "add-group", id: randomUUID(), name: groupName })
                )
                  setGroupName("");
              }}
            >
              <Input
                aria-label="New group name"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                maxLength={60}
              />
              <Button type="submit" disabled={!groupName.trim()}>
                Add group
              </Button>
            </form>
            {state.groups.map((group) => (
              <form
                key={group.id}
                className="flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const name = data.get("name");
                  if (typeof name === "string")
                    onChange({ type: "rename-group", id: group.id, name });
                }}
              >
                <div className="min-w-0 flex-1">
                  <Input
                    name="name"
                    aria-label={"Rename " + group.name}
                    defaultValue={group.name}
                    maxLength={60}
                    required
                  />
                </div>
                <Button type="submit" variant="outline">
                  Rename
                </Button>
                <Button
                  variant="destructive-outline"
                  onClick={() => onChange({ type: "remove-group", id: group.id })}
                >
                  Remove {group.name}
                </Button>
              </form>
            ))}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
