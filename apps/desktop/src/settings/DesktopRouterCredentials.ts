import { RouterProbeInput, type RouterCredentialRequest } from "@madar/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

const Document = Schema.fromJsonString(Schema.Array(RouterProbeInput));
const decodeDocument = Schema.decodeEffect(Document);
const encodeDocument = Schema.encodeEffect(Document);

export class RouterCredentialError extends Schema.TaggedError<RouterCredentialError>()(
  "RouterCredentialError",
  { operation: Schema.Literals(["unavailable", "read", "write"]), cause: Schema.Defect() },
) {
  override get message() {
    return `Router credential storage failed during ${this.operation}.`;
  }
}

export class DesktopRouterCredentials extends Context.Service<
  DesktopRouterCredentials,
  {
    readonly access: (
      request: RouterCredentialRequest,
    ) => Effect.Effect<string | null, RouterCredentialError>;
  }
>()("@madar/desktop/settings/DesktopRouterCredentials") {}

const isRouterCredentialError = Schema.is(RouterCredentialError);

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const secure = yield* ElectronSafeStorage.ElectronSafeStorage;
  const lock = yield* Semaphore.make(1);
  const file = environment.path.join(environment.stateDir, "router-credentials.bin");
  const temporary = `${file}.tmp`;
  const read = Effect.fn("DesktopRouterCredentials.read")(function* () {
    const bytes = yield* fs.readFile(file).pipe(
      Effect.asSome,
      Effect.catchTags({
        PlatformError: (error) =>
          error.reason._tag === "NotFound" ? Effect.succeedNone : Effect.fail(error),
      }),
    );
    if (Option.isNone(bytes)) return [];
    return yield* decodeDocument(yield* secure.decryptString(bytes.value));
  });
  return DesktopRouterCredentials.of({
    access: Effect.fn("DesktopRouterCredentials.access")(
      function* (request: RouterCredentialRequest) {
        const backend = yield* secure.selectedStorageBackend;
        if (!(yield* secure.isEncryptionAvailable) || Option.contains(backend, "basic_text"))
          return yield* new RouterCredentialError({ operation: "unavailable", cause: undefined });
        const entries = yield* read().pipe(
          Effect.mapError((cause) => new RouterCredentialError({ operation: "read", cause })),
        );
        if (request.kind === "get") {
          const saved = entries.find(
            ({ profile }) =>
              profile.id === request.profile.id &&
              profile.host.toLowerCase() === request.profile.host.toLowerCase() &&
              profile.username === request.profile.username,
          );
          return saved?.password ?? null;
        }
        const id = request.kind === "set" ? request.profile.id : request.profileId;
        const next = entries.filter(({ profile }) => profile.id !== id);
        if (request.kind === "set")
          next.push({ profile: request.profile, password: request.password });
        yield* Effect.gen(function* () {
          const encoded = yield* encodeDocument(next);
          const encrypted = yield* secure.encryptString(encoded);
          yield* fs.makeDirectory(environment.stateDir, { recursive: true });
          yield* fs.writeFile(temporary, encrypted, { mode: 0o600 });
          yield* fs.rename(temporary, file);
        }).pipe(
          Effect.onError(() => fs.remove(temporary).pipe(Effect.ignore)),
          Effect.mapError((cause) => new RouterCredentialError({ operation: "write", cause })),
        );
        return null;
      },
      lock.withPermits(1),
      Effect.mapError((cause) =>
        isRouterCredentialError(cause)
          ? cause
          : new RouterCredentialError({ operation: "unavailable", cause }),
      ),
    ),
  });
});

export const layer = Layer.effect(DesktopRouterCredentials, make);
