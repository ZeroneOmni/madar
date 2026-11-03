import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { render } from "../test/render";
import { AppRoot } from "./AppRoot";
import { notifyShell } from "./shell/notifications";
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

it("switches languages in Settings, searches Arabic commands and preserves the choice on restart", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/settings/general");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "العربية", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "عام", exact: true })).toBeVisible();
  expect(document.documentElement.lang).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  await screen.getByRole("button", { name: "تنظيم التنقل", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "تنظيم التنقل" });
  await dialog.getByRole("textbox", { name: "اسم المجموعة الجديدة" }).fill("يومي");
  await dialog.getByRole("button", { name: "إضافة مجموعة", exact: true }).click();
  await dialog.getByRole("combobox", { name: "مجموعة القسائم" }).click();
  await page.getByRole("option", { name: "يومي", exact: true }).click();
  await dialog.getByRole("button", { name: "تم", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "يومي", exact: true })).toBeVisible();
  await screen.getByRole("searchbox", { name: "البحث في الإعدادات" }).fill("اللغة");
  await screen.getByRole("button", { name: "اللغة", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "اللغة", exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "فتح لوحة الأوامر", exact: true }).click();
  await page.getByRole("combobox", { name: "البحث عن أمر" }).fill("القسائم");
  await page.getByText("الانتقال إلى القسائم", { exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "القسائم", exact: true })).toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect
    .element(restarted.getByRole("heading", { name: "القسائم", exact: true }))
    .toBeVisible();
  await restarted.getByRole("button", { name: "فتح الإعدادات", exact: true }).click();
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
  await screen.getByRole("button", { name: "Open Settings", exact: true }).click();
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

it("persists groups and pinning, then removes the group without losing destinations", async () => {
  await page.viewport(1280, 900);
  using _state = setup("/overview");
  await using screen = await render(<AppRoot />);
  await screen.getByRole("button", { name: "Organize navigation" }).click();
  const dialog = page.getByRole("dialog", { name: "Organize navigation" });
  await dialog.getByRole("textbox", { name: "New group name" }).fill("Daily");
  await dialog.getByRole("button", { name: "Add group", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Group for Usage" }).click();
  await page.getByRole("option", { name: "Daily", exact: true }).click();
  await dialog.getByRole("button", { name: "Pin Vouchers", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect.element(screen.getByRole("button", { name: "Daily", exact: true })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: "Vouchers - Pinned", exact: true }))
    .toBeVisible();
  await screen.unmount();
  await using restarted = await render(<AppRoot />);
  await expect.element(restarted.getByRole("button", { name: "Daily", exact: true })).toBeVisible();
  await restarted.getByRole("button", { name: "Organize navigation" }).click();
  await page.getByRole("button", { name: "Unpin Vouchers", exact: true }).click();
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
  await page.getByRole("button", { name: "Pin Usage", exact: true }).click();
  await expect
    .element(page.getByRole("dialog").getByRole("alert"))
    .toHaveTextContent(
      "Could not save navigation. Your previous layout is still in use. Please try again.",
    );
  await expect
    .element(page.getByRole("button", { name: "Pin Usage", exact: true }))
    .toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pin Usage", exact: true }).click();
  await expect
    .element(page.getByRole("button", { name: "Unpin Usage", exact: true }))
    .toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await userEvent.keyboard("{Control>}k{/Control}");
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
});
