import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { pickThemeFiles, saveThemeFile } from "./themeFiles.ts";

it.effect("native import/export round-trips bytes and cancellation leaves files untouched", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped();
    const destination = path.join(dir, "theme.json");
    let cancel = false;
    const layer = Layer.mergeAll(
      Layer.mock(ElectronWindow.ElectronWindow, { focusedMainOrFirst: Effect.succeedNone }),
      Layer.mock(ElectronDialog.ElectronDialog, {
        saveFile: () => Effect.succeed(cancel ? Option.none() : Option.some(destination)),
        pickFiles: () => Effect.succeed(cancel ? [] : [destination]),
      }),
    );
    const text =
      '{"version":1,"name":"Round trip","appearance":"dark","colors":{"canvas":"#112233"}}\n';
    assert.isTrue(
      yield* saveThemeFile.handler({ name: "theme.json", text }).pipe(Effect.provide(layer)),
    );
    assert.equal(yield* fs.readFileString(destination), text);
    assert.deepEqual(yield* pickThemeFiles.handler(undefined).pipe(Effect.provide(layer)), [
      { name: "theme.json", size: new TextEncoder().encode(text).length, text },
    ]);
    cancel = true;
    assert.isFalse(
      yield* saveThemeFile
        .handler({ name: "theme.json", text: "changed" })
        .pipe(Effect.provide(layer)),
    );
    assert.isNull(yield* pickThemeFiles.handler(undefined).pipe(Effect.provide(layer)));
    assert.equal(yield* fs.readFileString(destination), text);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
