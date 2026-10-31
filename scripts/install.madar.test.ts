// @effect-diagnostics nodeBuiltinImport:off -- Exercises the PowerShell installer and generated command in an isolated home.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as HostProcess from "@madar/shared/HostProcess";
import { expect, it } from "vite-plus/test";

it.skipIf(HostProcess.Platform.defaultValue() !== "win32")(
  "reinstalls the Madar launcher without touching T3 Code or duplicating its runtime registration",
  () => {
    const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "madar-install-"));
    try {
      const madarHome = NodePath.join(root, "Madar home");
      const t3Home = NodePath.join(root, "T3 home");
      const bin = NodePath.join(root, "bin");
      const runtime = NodePath.join(madarHome, "runtime", "versions", "1.2.3");
      NodeFS.mkdirSync(runtime, { recursive: true });
      NodeFS.mkdirSync(t3Home);
      NodeFS.writeFileSync(NodePath.join(t3Home, "untouched"), "original T3 data");
      NodeFS.writeFileSync(NodePath.join(runtime, ".install-complete"), "1.2.3");
      NodeFS.copyFileSync(process.execPath, NodePath.join(runtime, "madar.exe"));
      const env = {
        ...process.env,
        MADAR_HOME: madarHome,
        MADAR_INSTALL_BIN_DIR: bin,
        MADAR_VERSION: "1.2.3",
        T3CODE_HOME: t3Home,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        const installed = NodeChildProcess.spawnSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            NodePath.join(import.meta.dirname, "install.ps1"),
          ],
          { env, encoding: "utf8" },
        );
        expect(installed.status, installed.stdout + installed.stderr).toBe(0);
      }
      const shim = NodePath.join(bin, "madar.cmd");
      const launched = NodeChildProcess.spawnSync("cmd.exe", ["/d", "/c", shim, "--version"], {
        env,
        encoding: "utf8",
      });
      expect(launched.status, launched.stdout + launched.stderr).toBe(0);
      expect(launched.stdout.trim()).toBe(process.version);
      expect(
        NodeFS.readFileSync(NodePath.join(madarHome, "runtime", "launchers"), "utf8").trim(),
      ).toBe(shim);
      expect(NodeFS.readdirSync(t3Home)).toEqual(["untouched"]);
      expect(NodeFS.readFileSync(NodePath.join(t3Home, "untouched"), "utf8")).toBe(
        "original T3 data",
      );
    } finally {
      NodeFS.rmSync(root, { recursive: true, force: true });
    }
  },
);
