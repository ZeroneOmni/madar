// @effect-diagnostics nodeBuiltinImport:off - Tests exercise root env file precedence directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { loadRepoEnv } from "./public-config.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadRepoEnv", () => {
  it("does not publish retired authentication settings to frontend aliases", () => {
    const repoRoot = makeTemporaryDirectory();
    expect(
      loadRepoEnv({ baseEnv: { MADAR_CLERK_PUBLISHABLE_KEY: "retired" }, repoRoot }),
    ).not.toHaveProperty("VITE_CLERK_PUBLISHABLE_KEY");
  });
  it("applies process, root local, and root precedence in that order", () => {
    const repoRoot = makeTemporaryDirectory();
    NodeFS.writeFileSync(
      NodePath.join(repoRoot, ".env"),
      "MADAR_TEST_VALUE=root\nMADAR_ROOT_ONLY=kept\n",
    );
    NodeFS.writeFileSync(NodePath.join(repoRoot, ".env.local"), "MADAR_TEST_VALUE=local\n");
    expect(loadRepoEnv({ baseEnv: {}, repoRoot })).toMatchObject({
      MADAR_TEST_VALUE: "local",
      MADAR_ROOT_ONLY: "kept",
    });
    expect(loadRepoEnv({ baseEnv: { MADAR_TEST_VALUE: "process" }, repoRoot })).toMatchObject({
      MADAR_TEST_VALUE: "process",
      MADAR_ROOT_ONLY: "kept",
    });
  });
});

function makeTemporaryDirectory() {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "madar-public-config-"));
  temporaryDirectories.push(directory);
  return directory;
}
