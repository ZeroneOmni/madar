# Architecture

Madar targets a desktop GUI for MikroTik User Manager. The Electron renderer uses the
existing React UI foundations. The backend currently serves desktop metadata, authentication,
and static assets; User Manager integration awaits a RouterOS version and connection-method decision.

## Existing data

Madar stores local authentication in `madar.sqlite`. It never copies or migrates the inherited
`state.sqlite` or `statev2.sqlite` databases; those files remain untouched. New User Manager models
should use their own domain shapes.

## Runtime boundaries

Keep Electron launch and authentication compatible with the backend. The desktop readiness probe
uses the environment metadata endpoint; it must become available only after the server can serve
requests. The backend retains its state-directory ownership lock, SQLite worker infrastructure,
static-asset caching, tracing, and event-loop monitoring.

Keep filesystem and integration work behind Effect services. HTTP handlers decode requests, call
a service, and map its errors. Shared wire schemas belong in `packages/contracts`.
