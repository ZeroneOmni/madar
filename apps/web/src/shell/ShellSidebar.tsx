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
  Search,
  Settings,
  Ticket,
  Waypoints,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
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

function ShellSidebarHeader({ title }: { title: string }) {
  const { isMobile, open } = useSidebar();
  if (!isMobile && !open) {
    return <div className="h-(--workspace-topbar-height) shrink-0" />;
  }
  return (
    <div className="shrink-0 pt-(--shell-sidebar-caption-height)">
      <div className="drag-region flex h-(--workspace-topbar-height) min-w-0 items-center ps-(--shell-brand-inset) pe-3">
        <span className="truncate text-lg font-semibold">{title}</span>
      </div>
    </div>
  );
}

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
  const { isMobile, open } = useSidebar();
  const compact = !isMobile && !open;
  const { section } = resolveSettingsPath(path);
  const matches = searchSettings(query, t);
  const ReturnIcon = direction === "rtl" ? ArrowRight : ArrowLeft;
  return (
    <>
      {!compact && (
        <SidebarHeader>
          <Input
            type="search"
            aria-label={t("Search settings")}
            placeholder={t("Search settings...")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </SidebarHeader>
      )}
      <SidebarContent>
        <nav
          aria-label={query.trim() ? t("Settings search results") : t("Settings sections")}
          className="p-2"
        >
          <SidebarMenu>
            {!compact && query.trim()
              ? matches.map((item) => {
                  const Icon = settingsIcons[item.section];
                  return (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        tooltip={t(item.title)}
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
                        tooltip={t(item.label)}
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
          {!compact && query.trim() && matches.length === 0 ? (
            <p role="status" className="py-2 text-sm text-muted-foreground">
              {t("No settings found. Try another search.")}
            </p>
          ) : null}
        </nav>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("Return")}
              aria-label={t("Return")}
              onClick={() => onNavigate(returnPath)}
            >
              <ReturnIcon />
              <span>{t("Return")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
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
  const pathname = path.split("?")[0];
  const settingsPage = pathname === "/settings" || pathname?.startsWith("/settings/");
  const [returnPath, setReturnPath] = useState("/overview");
  if (!settingsPage && path !== returnPath) setReturnPath(path);
  const [editing, setEditing] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [dragged, setDragged] = useState<DestinationId | null>(null);
  const { setOpenMobile, isMobile, open } = useSidebar();
  const compact = !isMobile && !open;
  const organizing = editing && !compact && !settingsPage;
  if (editing && !organizing) {
    setEditing(false);
    setDragged(null);
  }
  function navigate(path: string) {
    setEditing(false);
    setDragged(null);
    onNavigate(path);
    if (isMobile) setOpenMobile(false);
  }
  function rows(group: string) {
    const items = state.items.filter((item) => compact || item.group === group);
    return (
      <SidebarMenu>
        {items.map((item, index) => {
          const destination = destinations.find((d) => d.id === item.id)!;
          const Icon = icons[item.id];
          return (
            <SidebarMenuItem
              key={item.id}
              draggable={organizing}
              onDragStart={(event) => {
                if (!organizing) {
                  event.preventDefault();
                  return;
                }
                setDragged(item.id);
                event.dataTransfer.setData("text/plain", item.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDragged(null)}
              onDragOver={(event) => {
                if (organizing && dragged) event.preventDefault();
              }}
              onDrop={(event) => {
                if (!organizing || !dragged) return;
                event.preventDefault();
                event.stopPropagation();
                onChange({ type: "move", id: dragged, before: item.id });
                setDragged(null);
              }}
            >
              <div
                className={
                  organizing
                    ? "flex cursor-grab items-center gap-1 active:cursor-grabbing"
                    : undefined
                }
              >
                <div className="min-w-0 flex-1">
                  <SidebarMenuButton
                    tooltip={t(destination.label)}
                    isActive={path.split("?")[0] === "/" + item.id}
                    onClick={() => navigate("/" + item.id)}
                    aria-current={path.split("?")[0] === "/" + item.id ? "page" : undefined}
                  >
                    <Icon />
                    <span>{t(destination.label)}</span>
                  </SidebarMenuButton>
                </div>
                {organizing ? (
                  <div
                    className="flex shrink-0 items-center"
                    role="group"
                    aria-label={t("{name} navigation", { name: t(destination.label) })}
                  >
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t("Move {name} up", { name: t(destination.label) })}
                      disabled={index === 0}
                      onClick={() => {
                        const before = items[index - 1];
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
                      size="icon-xs"
                      aria-label={t("Move {name} down", { name: t(destination.label) })}
                      disabled={index === items.length - 1}
                      onClick={() => {
                        const next = items[index + 1];
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
                  </div>
                ) : null}
              </div>
              {organizing && state.groups.length > 0 ? (
                <div className="ms-6 mb-2">
                  <Select
                    value={item.group}
                    onValueChange={(group) => {
                      if (group !== null) onChange({ type: "assign", id: item.id, group });
                    }}
                  >
                    <SelectTrigger
                      aria-label={t("Group for {name}", { name: t(destination.label) })}
                    >
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
                </div>
              ) : null}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    );
  }
  return (
    <Sidebar
      side={direction === "rtl" ? "right" : "left"}
      collapsible="icon"
      resizable={{ storageKey: "madar:shell-sidebar-width", minWidth: 240, maxWidth: 420 }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && organizing && !event.defaultPrevented) {
          setEditing(false);
          setDragged(null);
        }
      }}
    >
      <ShellSidebarHeader title={settingsPage ? t("Settings") : "Madar"} />
      {settingsPage ? (
        <SettingsNavigation path={path} onNavigate={navigate} returnPath={returnPath} />
      ) : compact ? (
        <>
          <SidebarContent>
            <nav aria-label={t("Workspace")} className="p-2">
              {rows("")}
            </nav>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip={t("Settings")}
                  aria-label={t("Settings")}
                  onClick={() => navigate("/settings/general")}
                >
                  <Settings />
                  <span>{t("Settings")}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </>
      ) : (
        <>
          <SidebarHeader>
            <Button variant="outline" onClick={onCommand}>
              <Search />
              {t("Commands")}
            </Button>
          </SidebarHeader>
          <SidebarContent>
            <nav aria-label={t("Workspace")} className="space-y-4 p-3">
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {t(error)}
                </p>
              ) : null}
              {organizing ? (
                <p className="text-xs text-muted-foreground">
                  {t("Drag destinations or use the arrows. Changes are saved automatically.")}
                </p>
              ) : null}
              <section
                aria-label={t("Workspace destinations")}
                onDragOver={(event) => {
                  if (organizing && dragged) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!organizing || !dragged) return;
                  event.preventDefault();
                  onChange({ type: "assign", id: dragged, group: "" });
                  setDragged(null);
                }}
              >
                <h2 className="mb-2 text-xs font-medium text-muted-foreground">{t("Workspace")}</h2>
                {rows("")}
              </section>
              {state.groups.map((group) => (
                <section
                  key={group.id}
                  onDragOver={(event) => {
                    if (organizing && dragged) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    if (!organizing || !dragged) return;
                    event.preventDefault();
                    onChange({ type: "assign", id: dragged, group: group.id });
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
                  {organizing &&
                  !group.collapsed &&
                  !state.items.some((item) => item.group === group.id) ? (
                    <p className="py-2 text-xs text-muted-foreground">
                      {t("Drop a destination here or choose its group.")}
                    </p>
                  ) : null}
                </section>
              ))}
              {organizing ? (
                <div className="space-y-3 border-t pt-3">
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
                    <div className="min-w-0 flex-1">
                      <Input
                        dir="auto"
                        aria-label={t("New group name")}
                        value={groupName}
                        onChange={(event) => setGroupName(event.target.value)}
                        maxLength={60}
                      />
                    </div>
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
                </div>
              ) : null}
            </nav>
          </SidebarContent>
          <SidebarFooter>
            <Button
              variant={organizing ? "outline" : "ghost"}
              size="sm"
              aria-pressed={organizing}
              onClick={() => {
                setEditing(!editing);
                setDragged(null);
              }}
            >
              {organizing ? t("Done") : t("Organize navigation")}
            </Button>
            <Button variant="ghost" onClick={() => navigate("/settings/general")}>
              <Settings />
              {t("Settings")}
            </Button>
          </SidebarFooter>
        </>
      )}
      {!compact && <SidebarRail />}
    </Sidebar>
  );
}
