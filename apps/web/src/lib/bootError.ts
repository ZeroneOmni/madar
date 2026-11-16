export function showBootError(error: unknown) {
  console.error("Madar failed to start.", error);
  const bootShell = document.getElementById("boot-shell");
  if (!bootShell) return;

  const content = document.createElement("div");
  content.id = "boot-error";
  content.setAttribute("role", "alert");

  const message = document.createElement("p");
  message.textContent =
    document.documentElement.lang === "en" ? "Madar could not load." : "تعذّر تحميل مدار.";
  content.append(message);

  const recovery = document.createElement("p");
  recovery.textContent =
    document.documentElement.lang === "ar"
      ? "أعد فتح التطبيق أو حاول إعادة التحميل. إذا فتحت رابط إقران، فاستخدم رابط إقران جديدًا."
      : "Reopen the app or try Reload. If you opened a pairing link, use a fresh pairing link.";
  content.append(recovery);

  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = document.documentElement.lang === "en" ? "Reload" : "إعادة التحميل";
  reload.addEventListener("click", () => window.location.reload());
  content.append(reload);
  bootShell.replaceChildren(content);
}
