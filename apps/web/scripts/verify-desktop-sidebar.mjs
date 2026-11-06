import * as NodeAssert from "node:assert/strict";
import * as NodeChildProcess from "node:child_process";
import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { _electron as electron } from "playwright";
import { defaultNavigation, NAVIGATION_KEY } from "../src/shell/navigation.ts";

// oxlint-disable-next-line madar/no-global-process-runtime -- Standalone native verifier has no Effect runtime.
if (NodeOS.platform() !== "win32") {
  throw new Error("Native caption hit-testing requires Windows. Run the desktop build first.");
}

const desktopDir = NodeURL.fileURLToPath(new URL("../../desktop/", import.meta.url));
const requireDesktop = NodeModule.createRequire(NodePath.join(desktopDir, "package.json"));
const proofDir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "madar-sidebar-pointer-"));
const queryFile = NodePath.join(proofDir, "pointer.json");
const env = {
  ...process.env,
  APPDATA: NodePath.join(proofDir, "appdata"),
  MADAR_HOME: NodePath.join(proofDir, "home"),
  MADAR_DISABLE_AUTO_UPDATE: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
delete env.MADAR_PORT;
await NodeFSP.mkdir(env.APPDATA, { recursive: true });
const app = await electron.launch({
  executablePath: requireDesktop("electron"),
  args: [NodePath.join(desktopDir, "dist-electron/main.cjs")],
  cwd: desktopDir,
  env,
  recordVideo: { dir: proofDir, size: { width: 1280, height: 800 } },
});
console.log(`Isolated Electron PID ${app.process().pid}; evidence: ${proofDir}`);
const report = [];

async function nativePointer(query) {
  await NodeFSP.writeFile(queryFile, JSON.stringify(query));
  const output = NodeChildProcess.execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      NodeURL.fileURLToPath(new URL("./sidebar-native-pointer.ps1", import.meta.url)),
      "-QueryFile",
      queryFile,
    ],
    { encoding: "utf8" },
  );
  return query.click ? null : JSON.parse(output);
}

try {
  const page = await app.firstWindow();
  await page.waitForSelector('[data-sidebar="trigger"]');
  for (const locale of ["en", "ar"]) {
    for (const mode of ["restored", "maximized", "fullscreen", "minimize-restore"]) {
      await app.evaluate(async ({ BrowserWindow }, mode) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win.isFullScreen()) {
          await new Promise((resolve) => {
            win.once("leave-full-screen", resolve);
            win.setFullScreen(false);
          });
        }
        if (win.isMaximized()) win.unmaximize();
        win.setBounds({ x: 80, y: 80, width: 1100, height: 760 });
        if (mode === "maximized") {
          await new Promise((resolve) => {
            win.once("maximize", resolve);
            win.maximize();
          });
        } else if (mode === "fullscreen") {
          await new Promise((resolve) => {
            win.once("enter-full-screen", resolve);
            win.setFullScreen(true);
          });
        } else if (mode === "minimize-restore") {
          await new Promise((resolve) => {
            win.once("minimize", resolve);
            win.minimize();
          });
          await new Promise((resolve) => {
            win.once("restore", resolve);
            win.restore();
          });
        }
        win.show();
        win.focus();
      }, mode);
      for (const open of [true, false]) {
        await page.evaluate(
          ({ locale, navigation, key }) => {
            localStorage.setItem("madar:language", locale);
            localStorage.setItem("madar:theme-appearance-mode", "dark");
            localStorage.setItem(key, JSON.stringify(navigation));
            location.hash = "/overview";
          },
          { locale, navigation: { ...defaultNavigation, open }, key: NAVIGATION_KEY },
        );
        await page.reload();
        await page.waitForFunction(
          (open) =>
            document.querySelector('[data-sidebar="trigger"]')?.getAttribute("aria-expanded") ===
            String(open),
          open,
        );
        const native = await app.evaluate(({ BrowserWindow }) => {
          const win = BrowserWindow.getAllWindows()[0];
          return {
            handle: win.getNativeWindowHandle().readBigUInt64LE().toString(),
            zoom: win.webContents.getZoomFactor(),
          };
        });
        const points = await page.evaluate(() => {
          const button = document.querySelector('[data-sidebar="trigger"]').getBoundingClientRect();
          const header = document.querySelector("main > header").getBoundingClientRect();
          return [
            { x: button.x + button.width / 2, y: button.y + button.height / 2 },
            { x: header.x + header.width / 2, y: header.y + header.height / 2 },
          ];
        });
        const query = { ...native, points };
        const hits = await nativePointer(query);
        const result = { locale, mode, open, toggleHit: hits[0], headerHit: hits[1] };
        report.push(result);
        console.log(JSON.stringify(result));
        await page.screenshot({
          path: NodePath.join(proofDir, `${locale}-${mode}-${open ? "expanded" : "compact"}.png`),
        });
        if (hits[0] !== 1) continue;
        await page.waitForFunction(() =>
          document.querySelector('[data-sidebar="trigger"]').matches(":hover"),
        );
        await nativePointer({ ...query, click: true });
        await page.waitForFunction(
          (open) =>
            document.querySelector('[data-sidebar="trigger"]').getAttribute("aria-expanded") !==
            String(open),
          open,
        );
        NodeAssert.equal(
          hits[1],
          mode === "fullscreen" ? 1 : 2,
          "Blank header keeps native window dragging",
        );
      }
    }
  }
  await NodeFSP.writeFile(NodePath.join(proofDir, "report.json"), JSON.stringify(report, null, 2));
  NodeAssert.deepEqual(
    report.filter((result) => result.toggleHit !== 1),
    [],
    "Every toggle must be native client area, not window caption",
  );
} finally {
  await app.close();
}
