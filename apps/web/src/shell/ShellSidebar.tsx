import { useLocale } from "../useLocale";
import { useState } from "react";
import { randomUUID } from "../lib/utils";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Keyboard,
  Palette,
  Shield,
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

import { SETTINGS_SECTIONS, resolveSettingsPath, searchSettings } from "./settingsSearch";

const settingsIcons = {
  general: Settings,
  appearance: Palette,
  privacy: Shield,
  shortcuts: Keyboard,
  notifications: Bell,
};

function SettingsNavigation({
  path,
  onNavigate,
  returnPath,
}: {
  path: string;
  onNavigate: (path: string) => void;
  returnPath: string;
}) {
  const { t, direction } = useLocale();
  const [query, setQuery] = useState("");
  const { section } = resolveSettingsPath(path);
  const matches = searchSettings(query, t);
  const ReturnIcon = direction === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <>
      <SidebarHeader>
        <div className="flex h-11 items-center px-2 font-semibold">{t("Settings")}</div>
        <Input
          type="search"
          aria-label={t("Search settings")}
          placeholder={t("Search settings...")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </SidebarHeader>
      <SidebarContent>
        <nav
          aria-label={query.trim() ? t("Settings search results") : t("Settings sections")}
          className="p-3"
        >
          <SidebarMenu>
            {query.trim()
              ? matches.map((item) => {
                  const Icon = settingsIcons[item.section];
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        onClick={() => {
                          setQuery("");
                          onNavigate(`/settings/${item.section}?focus=${item.id}`);
                        }}
                      >
                        <Icon />
                        <span>{t(item.title)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })
              : SETTINGS_SECTIONS.map((item) => {
                  const Icon = settingsIcons[item.id];
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={section?.id === item.id}
                        aria-current={section?.id === item.id ? "page" : undefined}
                        onClick={() => onNavigate(`/settings/${item.id}`)}
                      >
                        <Icon />
                        <span>{t(item.label)}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
          </SidebarMenu>
          {query.trim() && matches.length === 0 ? (
            <p role="status" className="py-2 text-sm text-muted-foreground">
              {t("No settings found. Try another search.")}
            </p>
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <Button variant="ghost" onClick={() => onNavigate(returnPath)}>
          <ReturnIcon />
          {t("Return")}
        </Button>
      </SidebarFooter>
    </>
  );
}

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
  const { t, direction } = useLocale();
  const settingsPage = path === "/settings" || path.startsWith("/settings/");
  const [returnPath, setReturnPath] = useState("/overview");
  if (!settingsPage && path !== returnPath) setReturnPath(path);
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
                    {t(destination.label)}
                    {item.pinned ? t(" - Pinned") : ""}
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
        side={direction === "rtl" ? "right" : "left"}
        resizable={{ storageKey: "madar:shell-sidebar-width", minWidth: 240, maxWidth: 420 }}
      >
        {settingsPage ? (
          <SettingsNavigation path={path} onNavigate={navigate} returnPath={returnPath} />
        ) : (
          <>
            <SidebarHeader>
              <div className="flex h-11 items-center gap-2 px-2">
                <span className="font-semibold">Madar</span>
                <span className="text-xs text-muted-foreground">{t("User Manager")}</span>
              </div>
              <Button variant="outline" onClick={onCommand}>
                <Search />
                {t("Commands")}
              </Button>
            </SidebarHeader>
            <SidebarContent>
              <nav aria-label={t("Workspace")} className="space-y-4 p-3">
                <section
                  aria-label={t("Pinned")}
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
                  <h2 className="mb-2 text-xs font-medium text-muted-foreground">{t("Pinned")}</h2>
                  {state.items.some((item) => item.pinned) ? (
                    rows("", true)
                  ) : (
                    <p className="py-2 text-xs text-muted-foreground">
                      {t("Pin destinations with Organize navigation.")}
                    </p>
                  )}
                </section>
                <section aria-label={t("Workspace destinations")}>
                  <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                    {t("Workspace")}
                  </h2>
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
                        <bdi>{group.name}</bdi>
                      </Button>
                    </div>
                    {!group.collapsed ? rows(group.id) : null}
                    {!group.collapsed &&
                    !state.items.some((item) => item.group === group.id && !item.pinned) ? (
                      <p className="py-2 text-xs text-muted-foreground">
                        {t("Drop a destination here or assign one in Organize navigation.")}
                      </p>
                    ) : null}
                  </section>
                ))}
              </nav>
            </SidebarContent>
            <SidebarFooter>
              <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
                {t("Organize navigation")}
              </Button>
              <Button variant="ghost" onClick={() => navigate("/settings/general")}>
                <Settings />
                {t("Settings")}
              </Button>
            </SidebarFooter>
          </>
        )}
        <SidebarRail />
      </Sidebar>
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t("Organize navigation")}</DialogTitle>
            <DialogDescription>
              {t(
                "Drag destinations in the sidebar or use these controls. Changes are saved automatically.",
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(error)}
              </p>
            ) : null}
            <div className="space-y-4">
              {state.items.map((item, index) => {
                const label = t(destinations.find((d) => d.id === item.id)!.label);
                return (
                  <section
                    key={item.id}
                    className="space-y-2 rounded-lg border p-3"
                    aria-label={t("{name} navigation", { name: label })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{label}</span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("Move {name} up", { name: label })}
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
                          aria-label={t("Move {name} down", { name: label })}
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
                          aria-label={t(item.pinned ? "Unpin {name}" : "Pin {name}", {
                            name: label,
                          })}
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
                      <SelectTrigger aria-label={t("Group for {name}", { name: label })}>
                        <SelectValue>
                          {item.group
                            ? state.groups.find((group) => group.id === item.group)?.name
                            : t("Workspace")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="">{t("Workspace")}</SelectItem>
                        {state.groups.map((group) => (
                          <SelectItem key={group.id} value={group.id}>
                            <bdi>{group.name}</bdi>
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
                dir="auto"
                aria-label={t("New group name")}
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                maxLength={60}
              />
              <Button type="submit" disabled={!groupName.trim()}>
                {t("Add group")}
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
                    dir="auto"
                    aria-label={t("Rename {name}", { name: group.name })}
                    defaultValue={group.name}
                    maxLength={60}
                    required
                  />
                </div>
                <Button type="submit" variant="outline">
                  {t("Rename")}
                </Button>
                <Button
                  variant="destructive-outline"
                  onClick={() => onChange({ type: "remove-group", id: group.id })}
                >
                  {t("Remove {name}", { name: group.name })}
                </Button>
              </form>
            ))}
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>{t("Done")}</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
