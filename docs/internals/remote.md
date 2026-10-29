# Remote connections

The server owns its environment identity and authentication. Direct pairing,
Tailscale endpoints, and SSH forwarding change how a client reaches the server.
They do not change which environment owns its data or grants access.

A saved address may point at another machine after a network change. The client
checks the environment descriptor before sending credentials. An unavailable
saved environment must not fall back to a different environment.

Desktop main owns SSH process creation and authentication prompts. The renderer
uses the forwarded endpoint through the shared connection runtime.
[SSH cleanup](../../packages/ssh/src/tunnel.ts) stops a remote server only if the
launcher owns it; an already running server must survive a client disconnect.

Authentication remains the environment's responsibility for every route. See
[environment authentication](./environment-auth.md) and
[connection runtime](./connection-runtime.md).
