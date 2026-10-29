import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export class DesktopServerExposure extends Context.Service<
  DesktopServerExposure,
  {
    readonly configureFromSettings: (input: { readonly port: number }) => Effect.Effect<void>;
    readonly backendConfig: Effect.Effect<{
      readonly port: number;
      readonly bindHost: string;
      readonly httpBaseUrl: URL;
    }>;
  }
>()("@t3tools/desktop/backend/DesktopServerExposure") {}

export const layer = Layer.effect(
  DesktopServerExposure,
  Effect.gen(function* () {
    const port = yield* Ref.make(0);
    return DesktopServerExposure.of({
      configureFromSettings: (input) => Ref.set(port, input.port),
      backendConfig: Ref.get(port).pipe(
        Effect.map((port) => ({
          port,
          bindHost: "127.0.0.1",
          httpBaseUrl: new URL(`http://127.0.0.1:${port}`),
        })),
      ),
    });
  }),
);
