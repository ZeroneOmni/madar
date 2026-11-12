import * as Schema from "effect/Schema";

export const destinations = [
  {
    id: "overview",
    label: "Overview",
    description: "Your local Madar workspace and setup status.",
  },
  { id: "vouchers", label: "Vouchers", description: "Create and manage User Manager vouchers." },
  {
    id: "subscriptions",
    label: "Subscriptions",
    description: "Manage User Manager subscriptions.",
  },
  { id: "card-designs", label: "Card designs", description: "Manage voucher card designs." },
  { id: "usage", label: "Usage", description: "Check User Manager usage." },
  {
    id: "notifications",
    label: "Notifications",
    description: "Results and notices from this workspace.",
  },
] as const;
export const DestinationId = Schema.Literals([
  "overview",
  "vouchers",
  "subscriptions",
  "card-designs",
  "usage",
  "notifications",
]);
export type DestinationId = typeof DestinationId.Type;
const NavItem = Schema.Struct({ id: DestinationId, group: Schema.String });
const NavGroup = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  collapsed: Schema.Boolean,
});
export const NavigationSchema = Schema.Struct({
  open: Schema.Boolean,
  items: Schema.Array(NavItem),
  groups: Schema.Array(NavGroup),
});
export type NavigationState = typeof NavigationSchema.Type;
const decode = Schema.decodeSync(Schema.fromJsonString(NavigationSchema));
const encode = Schema.encodeSync(Schema.fromJsonString(NavigationSchema));
export const defaultNavigation: NavigationState = {
  open: true,
  items: destinations.map(({ id }) => ({ id, group: "" })),
  groups: [],
};
export const NAVIGATION_KEY = "madar:shell-navigation";

export function decodeNavigation(serialized: string | null): NavigationState {
  if (serialized === null) return defaultNavigation;
  const state = decode(serialized);
  const ids = new Set(state.items.map((item) => item.id));
  const groups = new Set(state.groups.map((group) => group.id));
  if (
    ids.size !== destinations.length ||
    state.items.length !== ids.size ||
    state.groups.length !== groups.size ||
    groups.has("") ||
    state.groups.some((group) => !group.name.trim()) ||
    state.items.some((item) => item.group !== "" && !groups.has(item.group))
  )
    throw new Error("Saved navigation is invalid.");
  return state;
}

export type NavigationAction =
  | { type: "open"; open: boolean }
  | {
      type: "move";
      id: DestinationId;
      before: DestinationId;
      after?: boolean;
      keepMembership?: boolean;
    }
  | { type: "assign"; id: DestinationId; group: string }
  | { type: "add-group"; id: string; name: string }
  | { type: "rename-group"; id: string; name: string }
  | { type: "remove-group"; id: string }
  | { type: "collapse-group"; id: string };

export function changeNavigation(
  state: NavigationState,
  action: NavigationAction,
): NavigationState {
  switch (action.type) {
    case "open":
      return { ...state, open: action.open };
    case "move": {
      const source = state.items.find((item) => item.id === action.id);
      const target = state.items.find((item) => item.id === action.before);
      if (!source || !target || source.id === target.id) return state;
      const items = state.items.filter((item) => item.id !== source.id);
      items.splice(items.findIndex((item) => item.id === target.id) + (action.after ? 1 : 0), 0, {
        ...source,
        group: action.keepMembership ? source.group : target.group,
      });
      return { ...state, items };
    }
    case "assign":
      if (action.group && !state.groups.some((group) => group.id === action.group)) return state;
      return {
        ...state,
        items: state.items.map((item) =>
          item.id === action.id ? { ...item, group: action.group } : item,
        ),
      };
    case "add-group":
      if (!action.name.trim() || !action.id || state.groups.some((group) => group.id === action.id))
        return state;
      return {
        ...state,
        groups: [...state.groups, { id: action.id, name: action.name.trim(), collapsed: false }],
      };
    case "rename-group":
      if (!action.name.trim()) return state;
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.id ? { ...group, name: action.name.trim() } : group,
        ),
      };
    case "collapse-group":
      return {
        ...state,
        groups: state.groups.map((group) =>
          group.id === action.id ? { ...group, collapsed: !group.collapsed } : group,
        ),
      };
    case "remove-group":
      return {
        ...state,
        groups: state.groups.filter((group) => group.id !== action.id),
        items: state.items.map((item) =>
          item.group === action.id ? { ...item, group: "" } : item,
        ),
      };
  }
}

export function saveNavigation(storage: Pick<Storage, "setItem">, state: NavigationState) {
  const serialized = encode(state);
  storage.setItem(NAVIGATION_KEY, serialized);
}

export function routeLabel(path: string) {
  const route = path.split("?")[0];
  if (route?.startsWith("/settings")) return "Settings";
  if (route === "/welcome") return "Welcome";
  if (route === "/routers") return "Router connections";
  return destinations.find(({ id }) => route === "/" + id)?.label ?? "Page not found";
}
