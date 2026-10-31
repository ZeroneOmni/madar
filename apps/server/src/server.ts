import * as Console from "effect/Console";
import * as EventLoopMonitor from "./observability/EventLoopMonitor.ts";
import * as Observability from "./observability/Observability.ts";
import * as ResourceAttribution from "./resourceTelemetry/ResourceAttribution.ts";
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeHttp from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentHttpApi } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServer, FetchHttpClient } from "effect/http";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as ServerConfig from "./config.ts";
import * as ServerHttp from "./http.ts";
import * as SqlitePersistence from "./persistence/Sqlite.ts";
import * as ServerOwnership from "./serverOwnership.ts";
import * as ServerEnvironment from "./environment/ServerEnvironment.ts";
import * as EnvironmentAuth from "./auth/EnvironmentAuth.ts";
import * as AuthHttp from "./auth/http.ts";
import * as ReplayMarkers from "./auth/replayMarkers.ts";
import * as ServerSecretStore from "./auth/ServerSecretStore.ts";
import {
  guardHttpResponseWriteErrors,
  rejectRequestsUntilServing,
} from "./httpResponseErrorGuard.ts";
import {
  acceptsPrivateNetworkConnection,
  issueHeadlessServeAccessInfo,
  formatHeadlessServeOutput,
  formatHostForUrl,
} from "./startupAccess.ts";
import { makePersistedServerRuntimeState } from "./serverRuntimeState.ts";
import * as ProcessRunner from "./processRunner.ts";
import * as ExternalLauncher from "./process/externalLauncher.ts";
import * as NetService from "@madar/shared/Net";
import * as ServiceLauncherClient from "./cloud/serviceLauncherClient.ts";
const HTTP_PREEMPTIVE_SHUTDOWN_GRACE_MS = 0;
const layerHttpServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    return NodeHttpServer.layer(
      () => {
        const server = rejectRequestsUntilServing(
          guardHttpResponseWriteErrors(NodeHttp.createServer()),
        );
        if (config.privateNetworkOnly) {
          server.on("connection", (socket) => {
            if (!acceptsPrivateNetworkConnection(socket)) {
              socket.destroy();
            }
          });
        }
        return server;
      },
      {
        host: config.host ?? "127.0.0.1",
        port: config.port,
        gracefulShutdownTimeout: HTTP_PREEMPTIVE_SHUTDOWN_GRACE_MS,
        // Context takeover stays enabled (ws default) so the compression
        // window is shared across frames — that also makes small frames cheap
        // to compress, so no size threshold is set (ws only honors
        // `threshold` when context takeover is disabled).
        websocket: { perMessageDeflate: true },
      },
    );
  }),
);

const layerServerEnvironment = ServerEnvironment.layer.pipe(Layer.provide(ServerSecretStore.layer));
const layerAuth = EnvironmentAuth.layer.pipe(
  Layer.provideMerge(SqlitePersistence.layerConfig),
  Layer.provide(layerServerEnvironment),
  Layer.provide(ServerSecretStore.layer),
);
const layerRoutes = Layer.mergeAll(
  HttpApiBuilder.layer(EnvironmentHttpApi).pipe(
    Layer.provide(AuthHttp.layer),
    Layer.provide(ServerHttp.layerServerEnvironmentHttpApi),
    Layer.provide(AuthHttp.layerAuthenticatedAuth),
  ),
  ServerHttp.layerStaticAndDevRoute,
).pipe(
  Layer.provide(ServerHttp.layerBrowserApiCors),
  Layer.provide(ServerHttp.layerHttpCompression),
);
const layerServer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const ownership = yield* ServerOwnership.acquireServerOwnership(config.serverRuntimeStatePath);
    const listening = Layer.effectDiscard(
      Effect.gen(function* () {
        const server = yield* HttpServer.HttpServer;
        const launcher = yield* ServiceLauncherClient.ServiceLauncherClient;
        yield* launcher.prepareTrial;
        if (typeof server.address !== "string" && "port" in server.address) {
          const state = yield* makePersistedServerRuntimeState({
            config,
            port: server.address.port,
            serviceManaged: launcher.managed,
          });
          yield* ownership.publish(state);
        }
        if (config.startupPresentation === "headless") {
          const access = yield* issueHeadlessServeAccessInfo();
          yield* Console.log(formatHeadlessServeOutput(access));
        } else if (config.mode !== "desktop") {
          const auth = yield* EnvironmentAuth.EnvironmentAuth;
          const base =
            config.devUrl?.toString() ??
            `http://${formatHostForUrl(config.host ?? "127.0.0.1")}:${config.port}`;
          const target = yield* auth.issueStartupPairingUrl(base);
          yield* Console.log(`  pairingUrl: ${target}`);
          if (!config.noBrowser) {
            const launcher = yield* ExternalLauncher.ExternalLauncher;
            yield* launcher.launchBrowser(target).pipe(
              Effect.withTracerEnabled(false),
              Effect.catch(() => Effect.logInfo("Open the pairing URL above in your browser.")),
            );
          }
        }
        yield* Effect.logInfo("Madar server ready");
      }),
    );
    return Layer.merge(listening, ReplayMarkers.layer).pipe(
      Layer.provideMerge(HttpRouter.serve(layerRoutes)),
      Layer.provideMerge(layerHttpServer),
      Layer.provide(layerAuth),
      Layer.provide(layerServerEnvironment),
      Layer.provide(ServerSecretStore.layer),
      Layer.provide(ServiceLauncherClient.layer),
      Layer.provide(ExternalLauncher.layer),
      Layer.provide(ProcessRunner.layer),
      Layer.provide(NetService.layer),
      Layer.provide(
        EventLoopMonitor.layer.pipe(
          Layer.provideMerge(Observability.layer),
          Layer.provideMerge(ResourceAttribution.layer),
        ),
      ),
      Layer.provide(FetchHttpClient.layer),
      Layer.provide(NodeServices.layer),
    );
  }),
).pipe(Layer.provide(ProcessRunner.layer));
export const runServer = Layer.launch(layerServer);
