import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ElectronDialog from "../../electron/ElectronDialog.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as Channels from "../channels.ts";

const MAX_BYTES = 256 * 1024;
export const pickThemeFiles = DesktopIpc.makeIpcMethod({
  channel: Channels.PICK_THEME_FILES_CHANNEL,
  payload: Schema.Undefined,
  result: Schema.NullOr(
    Schema.Array(Schema.Struct({ name: Schema.String, size: Schema.Number, text: Schema.String })),
  ),
  handler: Effect.fn("desktop.ipc.themeFiles.pick")(function* () {
    const dialog = yield* ElectronDialog.ElectronDialog;
    const windows = yield* ElectronWindow.ElectronWindow;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const paths = yield* dialog.pickFiles({
      owner: yield* windows.focusedMainOrFirst,
      defaultPath: Option.none(),
      filters: [{ name: "Theme JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (!paths.length) return null;
    return yield* Effect.forEach(paths, (file) =>
      Effect.gen(function* () {
        const size = Number((yield* fs.stat(file)).size);
        if (size > MAX_BYTES) return { name: path.basename(file), size, text: "" };
        return { name: path.basename(file), size, text: yield* fs.readFileString(file) };
      }),
    );
  }),
});
export const saveThemeFile = DesktopIpc.makeIpcMethod({
  channel: Channels.SAVE_THEME_FILE_CHANNEL,
  payload: Schema.Struct({ name: Schema.String, text: Schema.String }),
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.themeFiles.save")(function* (file) {
    if (new TextEncoder().encode(file.text).length > MAX_BYTES)
      return yield* Effect.die(new Error("Theme files must be 256 KB or smaller."));
    const dialog = yield* ElectronDialog.ElectronDialog;
    const windows = yield* ElectronWindow.ElectronWindow;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const destination = yield* dialog.saveFile(
      path.basename(file.name),
      yield* windows.focusedMainOrFirst,
    );
    if (Option.isNone(destination)) return false;
    yield* fs.writeFileString(destination.value, file.text);
    return true;
  }),
});
