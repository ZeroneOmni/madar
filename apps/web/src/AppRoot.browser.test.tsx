import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../test/render";
import { AppRoot } from "./AppRoot";
import { notifyShell } from "./shell/notifications";
import { decodeNavigation, defaultNavigation, NAVIGATION_KEY } from "./shell/navigation";
import "./index.css";

function setup(path = "/") {
  const previousLang = document.documentElement.lang;
  const previousDir = document.documentElement.dir;
  const saved = new Map<string, string>();
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith("madar:")) {
      saved.set(key, localStorage.getItem(key)!);
      localStorage.removeItem(key);
    }
  }
  const previousUrl = location.href;
  history.replaceState(null, "", "#" + path);
  return {
    [Symbol.dispose]() {
      for (const key of Object.keys(localStorage))
        if (key.startsWith("madar:")) localStorage.removeItem(key);
      for (const [key, value] of saved) localStorage.setItem(key, value);
      history.replaceState(null, "", previousUrl);
      document.documentElement.lang = previousLang;
      document.documentElement.dir = previousDir;
    },
  };
}

function nativeControls(initialSide: "left" | "right") {
  const previous = Object.getOwnPropertyDescriptor(navigator, "windowControlsOverlay");
  const events = new EventTarget();
  let side = initialSide;
  const overlay = Object.assign(events, {
    visible: true,
    getTitlebarAreaRect: () =>
      new DOMRect(side === "left" ? 138 : 0, 0, window.innerWidth - 138, 40),
  });
  Object.defineProperty(navigator, "windowControlsOverlay", { configurable: true, value: overlay });
  return {
    controls: () => new DOMRect(side === "left" ? 0 : window.innerWidth - 138, 0, 138, 40),
    move(next: "left" | "right") {
      side = next;
      events.dispatchEvent(new Event("geometrychange"));
    },
    [Symbol.dispose]() {
      if (previous) Object.defineProperty(navigator, "windowControlsOverlay", previous);
      else Reflect.deleteProperty(navigator, "windowControlsOverlay");
    },
  };
}

it.each([
  ["en", "left"],
  ["en", "right"],
  ["ar", "left"],
  ["ar", "right"],
] as const)(
  "keeps %s chrome clear of %s native controls through compact mode and geometry changes",
  async (language, side) => {
    await page.viewport(1280, 900);
    using _state = setup("/overview");
    using native = nativeControls(side);
    localStorage.setItem("madar:language", language);
    await using screen = await render(<AppRoot />);
    const trigger = screen.container.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]')!;
    const initial = trigger.getBoundingClientRect();
    function expectClear() {
      const controls = native.controls();
      const buttons = [
        trigger,
        ...screen.container.querySelectorAll<HTMLElement>("main > header button"),
      ];
      for (const button of buttons) {
        const rect = button.getBoundingClientRect();
        const overlaps =
          rect.left < controls.right &&
          rect.right > controls.left &&
          rect.top < controls.bottom &&
          rect.bottom > controls.top;
        expect(
          overlaps,
          button.textContent || button.getAttribute("aria-label") || "toolbar button",
        ).toBe(false);
      }
    }
    expectClear();
    await page.elementLocator(trigger).click();
    await expect.element(page.elementLocator(trigger)).toHaveAttribute("aria-expanded", "false");
    await vi.waitFor(() => {
      expect(trigger.getBoundingClientRect().x).toBe(initial.x);
      expect(trigger.getBoundingClientRect().y).toBe(initial.y);
      expectClear();
    });
    await page.viewport(1024, 768);
    await vi.waitFor(expectClear);
    native.move(side === "left" ? "right" : "left");
    await vi.waitFor(expectClear);
    await page.elementLocator(trigger).click();
    await expect.element(page.elementLocator(trigger)).toHaveAttribute("aria-expanded", "true");
    await vi.waitFor(expectClear);
  },
);

it.each([
  ["en", "Vouchers", "Settings", "Privacy", "Return", "Toggle Sidebar"],
  ["ar", "القسائم", "الإعدادات", "الخصوصية", "رجوع", "إظهار الشريط الجانبي أو إخفاؤه"],
] as const)(
  "keeps compact navigation usable and persisted in %s",
  async (language, vouchers, settings, privacy, back, toggle) => {
    await page.viewport(1280, 900);
    using _state = setup("/overview");
    localStorage.setItem("madar:language", language);
    localStorage.setItem(
      NAVIGATION_KEY,
      JSON.stringify({
        ...defaultNavigation,
        items: defaultNavigation.items.map((item) =>
          item.id === "vouchers" ? { ...item, group: "work" } : item,
        ),
        groups: [{ id: "work", name: "Work", collapsed: true }],
      }),
    );
    await using screen = await render(<AppRoot />);
    await screen.getByRole("button", { name: toggle, exact: true }).click();
    await expect.element(screen.getByRole("button", { name: vouchers, exact: true })).toBeVisible();
    await userEvent.hover(screen.getByRole("button", { name: vouchers, exact: true }));
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="tooltip-popup"]')?.textContent).toBe(vouchers),
    );
    await expect
      .element(
        page.elementLocator(document.querySelector<HTMLElement>('[data-slot="tooltip-popup"]')!),
      )
      .toBeVisible();
    await screen.getByRole("button", { name: vouchers, exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: vouchers, exact: true }))
      .toBeVisible();
    expect(decodeNavigation(localStorage.getItem(NAVIGATION_KEY)).open).toBe(false);
    await screen.getByRole("button", { name: settings, exact: true }).click();
    await screen.getByRole("button", { name: privacy, exact: true }).click();
    await expect.element(screen.getByRole("heading", { name: privacy, exact: true })).toBeVisible();
    await screen.getByRole("button", { name: back, exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: vouchers, exact: true }))
      .toBeVisible();
    await screen.unmount();
    await using restarted = await render(<AppRoot />);
    await expect
      .element(restarted.getByRole("button", { name: vouchers, exact: true }))
      .toBeVisible();
    await restarted.getByRole("button", { name: toggle, exact: true }).click();
    expect(decodeNavigation(localStorage.getItem(NAVIGATION_KEY)).open).toBe(true);
  },
);

it("switches languages in Settings, searches Arabic commands and preserves the choice on restart", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/settings/general");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "العربية", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "عام", exact: true })).toBeVisible();
  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  await screen.getByRole("button", { name: "رجوع", exact: true }).click();
  await screen.getByRole("button", { name: "تنظيم التنقل", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "تنظيم التنقل" });
  await dialog.getByRole("textbox", { name: "اسم المجموعة الجديدة" }).fill("يومي");
  await dialog.getByRole("button", { name: "إضافة مجموعة", exact: true }).click();
  await dialog.getByRole("combobox", { name: "مجموعة القسائم" }).click();
  await page.getByRole("option", { name: "يومي", exact: true }).click();
  await dialog.getByRole("button", { name: "تم", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "يومي", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await screen.getByRole("searchbox", { name: "البحث في الإعدادات" }).fill("اللغة");
  await screen.getByRole("button", { name: "اللغة", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "اللغة", exact: true })).toBeVisible();
  await userEvent.keyboard("{Control>}k{/Control}");
  await page.getByRole("combobox", { name: "البحث عن أمر" }).fill("القسائم");
  await page.getByText("الانتقال إلى القسائم", { exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "القسائم", exact: true })).toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect
    .element(restarted.getByRole("heading", { name: "القسائم", exact: true }))
    .toBeVisible();
  await restarted.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await restarted.getByRole("button", { name: "English", exact: true }).click();
  await expect
    .element(restarted.getByRole("heading", { name: "General", exact: true }))
    .toBeVisible();
  expect(document.documentElement.dir).toBe("ltr");
});

it("keeps the active language and reports a failed preference write", async () => {
  using _state = setup("/settings/general");
  await using screen = await render(<AppRoot />);
  using _storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage blocked");
  });
  await screen.getByRole("button", { name: "العربية", exact: true }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Could not save language. Your previous language is still active.");
  await expect.element(screen.getByRole("heading", { name: "General", exact: true })).toBeVisible();
});

it("explains navigation and shortcut failures in Arabic and offers localized notification controls", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/settings/shortcuts");
  localStorage.setItem("madar:language", "ar");
  localStorage.setItem("madar:shell-navigation", "invalid");
  await using screen = await render(<AppRoot />);
  await expect
    .element(
      screen.getByText("تعذر تحميل التنقل المحفوظ. أعد ضبطه أو حاول مجددًا عند توفر التخزين.", {
        exact: true,
      }),
    )
    .toBeVisible();
  const editor = screen.getByRole("form", { name: "اختصار فتح لوحة الأوامر" });
  await editor.getByRole("textbox", { name: "فتح لوحة الأوامر" }).fill("Mod+Q");
  await editor.getByRole("button", { name: "حفظ", exact: true }).click();
  await expect
    .element(editor.getByRole("alert"))
    .toHaveTextContent("هذا المفتاح محجوز لسطح المكتب أو المتصفح.");
  notifyShell({
    title: "Navigation was not saved",
    message: "Could not save navigation. Your previous layout is still in use. Please try again.",
    level: "error",
  });
  await expect.element(page.getByRole("button", { name: "نسخ الخطأ", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "تجاهل الإشعار", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "تجاهل الإشعار", exact: true }))
    .not.toBeInTheDocument();
});

it("completes welcome, searches Settings, preserves appearance and returns through breadcrumbs", async () => {
  await page.viewport(1280, 900);
  using _state = setup();
  await using screen = await render(<AppRoot />);
  await expect.element(screen.getByRole("heading", { name: "Welcome to Madar" })).toBeVisible();
  await screen.getByRole("button", { name: "Open workspace", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Your User Manager workspace" }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Settings", exact: true }).click();
  await screen.getByRole("searchbox", { name: "Search settings" }).fill("theme");
  await screen.getByRole("button", { name: "Appearance", exact: true }).click();
  await screen.getByRole("button", { name: "Dark", exact: true }).click();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
  await screen.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Your User Manager workspace" }))
    .toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect
    .element(restarted.getByRole("heading", { name: "Your User Manager workspace" }))
    .toBeVisible();
  expect(document.documentElement.classList.contains("dark")).toBe(true);
});

it("keeps the chosen monospace size in theme editors and workspace after restart", async () => {
  using _state = setup("/settings/appearance");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("combobox", { name: "Monospace font size", exact: true }).click();
  await page.getByRole("option", { name: "18 px", exact: true }).click();
  await screen.getByRole("button", { name: "Add theme", exact: true }).click();
  const editor = screen.container.ownerDocument.querySelector('textarea[aria-label="Theme JSON"]')!;
  await vi.waitFor(() => expect(getComputedStyle(editor).fontSize).toBe("18px"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await screen.getByRole("button", { name: "Create theme", exact: true }).click();
  const hex = screen.container.ownerDocument.querySelector(
    'input[aria-label="Accent color hex value"]',
  )!;
  await vi.waitFor(() => expect(getComputedStyle(hex).fontSize).toBe("18px"));
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await screen.unmount();
  history.replaceState(null, "", "#/overview");
  await using restarted = await render(<AppRoot />);
  const address = restarted.container.querySelector("code")!;
  await vi.waitFor(() => expect(getComputedStyle(address).fontSize).toBe("18px"));
});

it("persists groups, then removes the group without losing destinations", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/overview");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Organize navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Organize navigation" });
  await dialog.getByRole("textbox", { name: "New group name" }).fill("Daily");
  await dialog.getByRole("button", { name: "Add group", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Group for Usage" }).click();
  await page.getByRole("option", { name: "Daily", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Daily", exact: true })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Vouchers", exact: true })).toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect.element(restarted.getByRole("button", { name: "Daily", exact: true })).toBeVisible();
  await restarted.getByRole("button", { name: "Organize navigation" }).click();
  await page.getByRole("button", { name: "Remove Daily", exact: true }).click();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect
    .element(restarted.getByRole("button", { name: "Daily", exact: true }))
    .not.toBeInTheDocument();
  await restarted.getByRole("button", { name: "Usage", exact: true }).click();
  await expect
    .element(restarted.getByRole("heading", { name: "Usage", exact: true }))
    .toBeVisible();
  await expect
    .element(restarted.getByRole("heading", { name: "User Manager is not connected" }))
    .toBeVisible();
});

it("retains navigation after a failed write and recovers on retry", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/overview");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Organize navigation" }).click();
  using _storage = vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new Error("Storage unavailable");
  });
  await page.getByRole("button", { name: "Move Vouchers up", exact: true }).click();
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toHaveTextContent(
      "Could not save navigation. Your previous layout is still in use. Please try again.",
    );
  expect(decodeNavigation(localStorage.getItem(NAVIGATION_KEY)).items[0]?.id).toBe("overview");
  await page.getByRole("button", { name: "Move Vouchers up", exact: true }).click();
  expect(decodeNavigation(localStorage.getItem(NAVIGATION_KEY)).items[0]?.id).toBe("vouchers");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await userEvent.keyboard("{Control>}k{/Control}");
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});

it("replaces workspace navigation with settings and returns to the previous destination", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/vouchers");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Settings", exact: true }).click();
  await expect
    .element(screen.getByRole("navigation", { name: "Workspace", exact: true }))
    .not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("complementary", { name: "Settings navigation" }))
    .not.toBeInTheDocument();
  await screen
    .getByRole("navigation", { name: "Settings sections", exact: true })
    .getByRole("button", { name: "Privacy", exact: true })
    .click();
  await expect.element(screen.getByRole("heading", { name: "Privacy", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Return", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Vouchers", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("navigation", { name: "Workspace", exact: true }))
    .toBeVisible();
});

it("uses settings navigation for a root settings deep link and returns to overview", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/settings?focus=language");
  await using screen = await render(<AppRoot />);
  await expect
    .element(screen.getByRole("navigation", { name: "Settings sections", exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("heading", { name: "Language", exact: true }))
    .toHaveFocus();
  await screen.getByRole("button", { name: "Return", exact: true }).click();
  await expect
    .element(screen.getByRole("heading", { name: "Your User Manager workspace", exact: true }))
    .toBeVisible();
});
