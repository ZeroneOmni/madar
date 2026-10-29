# Retained Connect backend

Madar retains the environment-side Connect implementation. The hosted relay deployment and its administration tools have been removed from this repository. The following constraints apply to the retained protocol and connector code.

## The relay is a trusted broker

An authenticated cloud user still needs an active environment link. The relay
asks that environment to mint a one-time bootstrap credential bound to the
client's DPoP key. The client exchanges it directly with the environment for an
[environment session](./environment-auth.md). The relay never receives that
session token, and possessing the bootstrap credential alone does not permit
redeeming it without the client's private key.

Both sides authenticate this exchange. The environment accepts only bounded,
replay-guarded relay proofs for its own identity, linked user, and requested
operation. Signed environment responses bind the result to the request nonce;
mint responses also bind the credential to the client proof key. The relay
verifies those bindings before returning a credential. This prevents a different
process behind the tunnel from impersonating the linked environment. The checks
meet in the
[environment link service](../../apps/server/src/cloud/CloudLink.ts).

The relay holds the signing authority for mint requests. DPoP protects an honest
exchange from credential reuse; it does not make a compromised relay signing
key harmless. Keep that trust assumption explicit when changing the protocol.

Managed tunnels expose only a validated loopback HTTP origin. Link proof checks
reject forwarded authority headers, and the relay resolves endpoints from its
own managed allocations rather than a caller-supplied URL. Health and mint
requests must not follow redirects. These restrictions keep endpoint discovery
from turning into arbitrary relay egress or exposing another service on the
environment host.

## A link outlives a connector process

CLI authorization, desired exposure, and a running connector have different
lifetimes. Linking can record intent while the server is stopped. Startup
reconciles that intent. CLI logout removes the stored cloud credential and
disables exposure without uninstalling the environment's background service.

Managed allocations belong to a user/environment pair. Provisioning checkpoints
external tunnel and DNS resources so retries can reconcile partial work. A
normal shutdown of a CLI-managed link releases its tunnel to avoid paying for
an idle resource, retaining the hostname reservation for the next startup.
It also retains the allocation record so the environment remains "offline"
rather than becoming "not authorized".

Two cases must retain the tunnel across shutdown. A link installed through a
client has no startup provisioning path and depends on its stored connector
token. An update handoff immediately starts a replacement server, and replacing
the tunnel would add routing propagation delay to every update. These exceptions
belong to [shutdown handling](../../apps/server/src/cloud/CloudLink.ts).

## The relay client follows the server's pin

The host runs `cloudflared` pinned by `CLOUDFLARED_VERSION` in
[`relayClient.ts`](../../packages/shared/src/relayClient.ts), and bumping it there
(version, URLs, and checksums) is the whole release step. A linked host that
starts a server with a new pin keeps its connector up on the newest older managed
release, installs the pinned one in the background, then starts a second
connector on it for the same tunnel. The old connector stops only after the new
one registers, so the swap never takes the host off the relay. If the new one
fails to spawn, the old one keeps serving and the install retries later. A host
with no relay client installs one first. A `cloudflared` on `PATH` or an explicit `T3CODE_CLOUDFLARED_PATH` is the
user's choice and is never replaced, since linking asks before downloading.

Once the pinned release registers a connection, managed releases older than the
pin are deleted except the newest of them. That one, and any newer release, can
belong to another server sharing the same T3 home, such as a rollback after a
failed update, which could not run again without it.

The version comes from running `cloudflared version`, not from the folder name.
Connectors from before `--no-autoupdate` replaced themselves in place, so a
managed folder can hold another release. Such a binary still runs as a fallback
while the pin installs. Every binary needs `CLOUDFLARED_MIN_VERSION`, the oldest
release that accepts every flag the connector is started with. Raise it whenever
a new flag is added.

## OAuth traps

Interactive clients and the headless CLI use the same Clerk application but
different credentials. The relay accepts both session-template JWTs and CLI
OAuth tokens; requiring a JWT template for the CLI would reject valid logins.
The CLI is a public OAuth client using PKCE and stores no client secret.

Loopback CLI authorization starts on the hosted `/connect` page so sign-in
completes before entering Clerk's authorize endpoint. Sending a signed-out
browser straight to that endpoint loses the authorize parameters during the
sign-in redirect. The [shared flow](../../packages/shared/src/connectAuth.ts)
preserves PKCE and state for the loopback callback.

SSH and headless sessions use Clerk's OAuth device authorization grant because
the browser cannot ordinarily reach a listener on the remote machine. The CLI
polls Clerk's token endpoint directly while the user approves a short code on
Clerk's hosted device page; the hosted app plays no part and there is no
redirect URI or PKCE. The grant must be enabled on the CLI OAuth application
or the device endpoint returns an error before any prompt is shown.
