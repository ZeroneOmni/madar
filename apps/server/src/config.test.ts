import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { deriveServerPaths, ensureServerDirectories } from "./config.ts";

it.layer(NodeServices.layer)("server directories", (it) => {
  it.effect("creates only current server directories and leaves retired data untouched", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped();
      const paths = yield* deriveServerPaths(home, undefined);
      yield* ensureServerDirectories(paths);
      expect((yield* fs.readDirectory(paths.stateDir)).sort()).toEqual(["logs"]);

      const attachment = path.join(paths.stateDir, "attachments", "pending", "legacy.txt");
      yield* fs.makeDirectory(path.dirname(attachment), { recursive: true });
      yield* fs.writeFileString(attachment, "existing data");
      yield* ensureServerDirectories(paths);
      expect(yield* fs.readFileString(attachment)).toBe("existing data");
    }),
  );
});
