import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as HostProcess from "@madar/shared/HostProcess";

import { findOwnedLauncher } from "./uninstall.ts";

it.layer(NodeServices.layer)("madar uninstall launcher", (it) => {
  it.effect("claims only a launcher that points into this home's runtime tree", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const platform = yield* HostProcess.Platform;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "madar-uninstall-" });
      const versionsDir = path.join(root, "runtime/versions");
      const exe = path.join(versionsDir, "1.0.0/madar");
      const otherExe = path.join(root, "other/runtime/versions/1.0.0/madar");
      const copy = path.join(root, "copy/madar");
      for (const file of [exe, otherExe, copy]) {
        yield* fs.makeDirectory(path.dirname(file), { recursive: true });
        yield* fs.writeFileString(file, "");
      }
      const launcherName = platform === "win32" ? "madar.cmd" : "madar";
      const ours = path.join(root, "bin", launcherName);
      const theirs = path.join(root, "other/bin", launcherName);
      yield* fs.makeDirectory(path.dirname(ours), { recursive: true });
      yield* fs.makeDirectory(path.dirname(theirs), { recursive: true });
      if (platform === "win32") {
        yield* fs.writeFileString(ours, `@echo off\r\n"${exe}" %*`);
        yield* fs.writeFileString(theirs, `@echo off\r\n"${otherExe}" %*`);
      } else {
        yield* fs.symlink(exe, ours);
        yield* fs.symlink(otherExe, theirs);
      }
      const findLauncher = (launchedAs: string | undefined) =>
        findOwnedLauncher({ launchedAs, versionsDir }).pipe(
          Effect.provideService(HostProcess.Environment, {
            PATH: [path.dirname(ours), path.dirname(theirs)].join(";"),
          }),
        );

      assert.equal(yield* findLauncher(platform === "win32" ? exe : ours), ours);
      assert.isUndefined(yield* findLauncher(platform === "win32" ? otherExe : theirs));
      assert.isUndefined(yield* findLauncher(copy));
      assert.isUndefined(yield* findLauncher(undefined));
    }).pipe(Effect.scoped),
  );
});
