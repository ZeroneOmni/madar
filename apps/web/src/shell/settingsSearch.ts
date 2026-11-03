export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "notifications", label: "Notifications" },
] as const;

const SETTINGS_SEARCH_ITEMS = [
  {
    id: "welcome",
    section: "general",
    title: "Welcome and onboarding",
    terms: "first run setup introduction reset",
  },
  {
    id: "quit-confirmation",
    section: "general",
    title: "Quit confirmation",
    terms: "desktop hold double click exit",
  },
  {
    id: "appearance",
    section: "appearance",
    title: "Appearance",
    terms: "theme system light dark color",
  },
  {
    id: "privacy",
    section: "privacy",
    title: "Mask sensitive text",
    terms: "privacy hide reveal clipboard application default workspace inherited override",
  },
  {
    id: "shortcuts",
    section: "shortcuts",
    title: "Keyboard shortcuts",
    terms: "keybinding hotkey command palette reset",
  },
  {
    id: "notifications",
    section: "notifications",
    title: "Notifications",
    terms: "desktop permission alerts toast history",
  },
] as const;

export function searchSettings(query: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return SETTINGS_SEARCH_ITEMS.filter((item) =>
    terms.every((term) => `${item.title} ${item.terms}`.toLocaleLowerCase().includes(term)),
  );
}

export function resolveSettingsPath(path: string) {
  const [pathname = "", query = ""] = path.split("?");
  const sectionId = pathname.split("/")[2] || "general";
  const section = SETTINGS_SECTIONS.find((item) => item.id === sectionId);
  const focus = new URLSearchParams(query).get("focus");
  const target =
    focus === null
      ? undefined
      : SETTINGS_SEARCH_ITEMS.find((item) => item.id === focus && item.section === sectionId);
  return { section, target, invalidTarget: focus !== null && target === undefined };
}
