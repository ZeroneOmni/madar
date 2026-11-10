export const SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" },
  { id: "shortcuts", label: "Keyboard shortcuts" },
  { id: "notifications", label: "Notifications" },
] as const;

const SETTINGS_SEARCH_ITEMS = [
  {
    id: "language",
    section: "general",
    title: "Language",
    terms: "Arabic English العربية عربي إنجليزي اللغة language",
  },
  {
    id: "welcome",
    section: "general",
    title: "Welcome and onboarding",
    terms: "first run setup introduction reset ترحيب إعداد مقدمة إعادة ضبط",
  },
  {
    id: "quit-confirmation",
    section: "general",
    title: "Quit confirmation",
    terms: "desktop hold double click exit سطح المكتب ضغط مطول مرتين خروج",
  },
  {
    id: "appearance",
    section: "appearance",
    title: "Appearance",
    terms:
      "theme system light dark color picker custom palette editor import export JSON السمات سمة نظام فاتح داكن ألوان منتقي تخصيص لوحة محرر استيراد تصدير",
  },
  {
    id: "interface-font",
    section: "appearance",
    title: "Interface font",
    terms: "typography font family size English Arabic",
  },
  {
    id: "monospace-font",
    section: "appearance",
    title: "Monospace font",
    terms: "typography font size voucher codes identifiers diagnostics",
  },
  {
    id: "contrast",
    section: "appearance",
    title: "Contrast",
    terms: "accessibility borders text",
  },
  {
    id: "glass-opacity",
    section: "appearance",
    title: "Glass opacity",
    terms: "accessibility transparency menus dialogs",
  },
  {
    id: "panel-animations",
    section: "appearance",
    title: "Panel animations",
    terms: "motion animation duration speed reduced",
  },
  {
    id: "privacy",
    section: "privacy",
    title: "Mask sensitive text",
    terms:
      "privacy hide reveal clipboard application default workspace inherited override خصوصية إخفاء إظهار حافظة تطبيق افتراضي مساحة العمل وراثة تجاوز",
  },
  {
    id: "shortcuts",
    section: "shortcuts",
    title: "Keyboard shortcuts",
    terms: "keybinding hotkey command palette reset اختصارات لوحة مفاتيح أمر أوامر إعادة ضبط",
  },
  {
    id: "notifications",
    section: "notifications",
    title: "Notifications",
    terms: "desktop permission alerts toast history إشعارات سطح المكتب إذن تنبيهات سجل",
  },
] as const;

export function searchSettings(
  query: string,
  t: (message: string) => string = (message) => message,
) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return SETTINGS_SEARCH_ITEMS.filter((item) =>
    terms.every((term) =>
      `${item.title} ${t(item.title)} ${t(SETTINGS_SECTIONS.find((section) => section.id === item.section)!.label)} ${item.terms}`
        .toLocaleLowerCase()
        .includes(term),
    ),
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
