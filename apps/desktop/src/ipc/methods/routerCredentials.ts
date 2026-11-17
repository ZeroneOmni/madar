import { RouterCredentialRequest } from "@madar/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopRouterCredentials from "../../settings/DesktopRouterCredentials.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const routerCredentials = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ROUTER_CREDENTIALS_CHANNEL,
  payload: RouterCredentialRequest,
  result: Schema.NullOr(Schema.String),
  handler: Effect.fn("desktop.ipc.routerCredentials")(function* (request) {
    const credentials = yield* DesktopRouterCredentials.DesktopRouterCredentials;
    return yield* credentials.access(request);
  }),
});
