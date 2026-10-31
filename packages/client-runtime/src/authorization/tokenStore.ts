import { EnvironmentId } from "@madar/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { ConnectionAttemptError } from "../connection/model.ts";

export class RemoteDpopAccessToken extends Schema.Class<RemoteDpopAccessToken>(
  "@madar/client-runtime/authorization/RemoteDpopAccessToken",
)({
  environmentId: EnvironmentId,
  accountId: Schema.optionalKey(Schema.String),
  label: Schema.String,
  endpoint: Schema.Struct({ httpBaseUrl: Schema.String, wsBaseUrl: Schema.String }),
  accessToken: Schema.String,
  expiresAtEpochMs: Schema.Number,
  dpopThumbprint: Schema.String,
}) {}

export class RemoteDpopAccessTokenStore extends Context.Service<
  RemoteDpopAccessTokenStore,
  {
    readonly get: (
      environmentId: EnvironmentId,
    ) => Effect.Effect<Option.Option<RemoteDpopAccessToken>, ConnectionAttemptError>;
    readonly put: (token: RemoteDpopAccessToken) => Effect.Effect<void, ConnectionAttemptError>;
    readonly remove: (environmentId: EnvironmentId) => Effect.Effect<void, ConnectionAttemptError>;
  }
>()("@madar/client-runtime/authorization/tokenStore/RemoteDpopAccessTokenStore") {}

const make = (service: RemoteDpopAccessTokenStore["Service"]) =>
  RemoteDpopAccessTokenStore.of(service);

export const layer = (service: RemoteDpopAccessTokenStore["Service"]) =>
  Layer.succeed(RemoteDpopAccessTokenStore, make(service));
