# Observability

> For maintainers. Using Madar? See [docs/user](../user/).

Madar has one server-side observability model:

- pretty logs go to stdout for humans
- completed spans go to a local NDJSON trace file
- traces, metrics, and logs can also be exported over OTLP to a real backend like Grafana LGTM

The local trace file is the persisted source of truth for normal local launches. Those launches do not
write a separate server log file.

## Where To Find Things

### Logs

Logs are human-facing:

- destination: stdout
- format: `Logger.consolePretty()`
- normal local persistence: none
- remote export: OTLP only, when configured

If you want a log message to show up in the trace file, emit it inside an active span with `Effect.log...`. `Logger.tracerLogger` will attach it as a span event.

Configuring a logs endpoint takes over that job. The server then exports log records, which cover
every message instead of only the ones inside an active span and carry the trace and span ids so
they still line up with the trace. `Logger.tracerLogger` is dropped in that mode, so the same
message is not exported twice and the trace file stops carrying log messages. stdout output stays unchanged.

### Traces

Completed spans are written as NDJSON records to `serverTracePath`. The default depends on how the
server starts: production and explicitly configured homes use
`<home>/userdata/logs/server.trace.ndjson` (so `~/.madar/userdata/...` by default, or
`/custom/path/userdata/...` with `--home-dir /custom/path`), a linked worktree dev run uses
`<worktree>/.madar/userdata/logs/server.trace.ndjson`, and an implicit dev run outside a linked
worktree uses `~/.madar/dev/logs/server.trace.ndjson`.

Important fields common to both record types:

- `type`: `effect-span` or `otlp-span`
- `name`: span name
- `traceId`, `spanId`, `parentSpanId`: correlation
- `durationMs`: elapsed time
- `attributes`: structured context
- `events`: embedded logs and custom events

`effect-span` records also contain `exit` with `Success`, `Failure`, or `Interrupted`. `otlp-span`
records instead carry OTLP resource, scope, and optional status fields.

The `TraceRecord`, `EffectTraceRecord`, and `OtlpTraceRecord` schemas live in
`packages/shared/src/observability.ts`.

SQL statement spans (named `sqlite`) and `sql.transaction` spans carry `db.connection` and
`db.lock_wait_ms`. `db.connection` is `writer` for the main connection, which runs on the event loop,
or `reader` for the read-only connection in a worker thread. `db.lock_wait_ms` is the part of the
span spent waiting for that connection, behind other SQL. That wait does not block the event loop,
so subtract it before you blame a slow span on the query. Statements inside a transaction use its
connection and do not carry these attributes.

DPoP proof failures include the safe `environment.dpop.failure_code` span
attribute. A `time_window` failure means that a signed proof was too old or too
far in the future for the environment server's allowed window. It can point to
a date or time problem on either device, but it can also result from a delayed
request.

#### Summarize the trace file

`madar trace summary` reads the trace file and its rotated backups directly, so it works while the
server is stalled or stopped. It prints counts, rates, and latency percentiles per span name. Use
it to measure background work or to compare two builds.

```bash
madar trace summary --since 30m --limit 40
```

It reads `MADAR_TRACE_FILE` if set, else `<home>/userdata/logs/server.trace.ndjson` for
`--base-dir` or `MADAR_HOME`, plus the `MADAR_TRACE_MAX_FILES` rotated backups. For a dev run or
a copied file, set `MADAR_TRACE_FILE`. `--since 30m` keeps spans that ended in the last 30
minutes. The rate is per minute between the first and last span end.

### Metrics

Metrics are not written to a local file.

- local persistence: none
- remote export: OTLP only, when configured
- current definitions: `apps/server/src/observability/Metrics.ts`

If OTLP is not configured, metrics still exist in-process, but you will not have a local artifact to inspect.

### Event Loop Stalls

`apps/server/src/observability/EventLoopMonitor.ts` samples the server's event loop every 30 s. When
the loop stalled for more than 2 s since the previous sample, it records a root
`server.eventLoop.stall` span with a warning. The span has trace level `Warn`, so it stays when
`MADAR_TRACE_MIN_LEVEL` is `Warn`. The span time is when the sample ran, not when the stall happened.

The trace file rotates in well under an hour on a busy server, so each stall is also appended as one
NDJSON line to `event-loop-stalls.ndjson`, next to the trace file. A line has `time` and the span
attributes. The file keeps the last 1000 or more stalls, with one rotated backup
(`event-loop-stalls.ndjson.1`). Use it to see how often a server stalls over days.

Some delay is not recorded:

- `delayMaxMs` is the longest stall, and can undercount it by up to 1 s. The 2 s threshold applies to
  this value, so a stall over 3 s is normally recorded, and a shorter one can be missed. A stall
  that ends just as a sample runs can be missed too.
- Time the computer spends asleep reads as delay on macOS and Windows. So a sample only counts when
  the loop was busy, not waiting for events, for at least `delayMaxMs`. Busy time covers the whole
  window, so a short sleep in an otherwise busy window can still record a false stall. The span then
  shows CPU time far below `delayMaxMs`.
- The first sample after launch is skipped. Startup work such as migrations
  can block the loop for seconds on a large database.

CPU times and page faults cover the whole process over the whole window since the previous sample.
The window is nominally 30 s, but a long stall delays the sample and makes the window longer. Other
work in the window can hide a wait, so only CPU time far below `delayMaxMs` proves the thread was
waiting. Read CPU together with page faults:

- High `cpuSystemMs` with many page faults means memory pressure. Major faults are reads from disk or swap.
  On macOS, reads from compressed memory are minor faults plus system CPU.
- High `cpuUserMs` with few page faults means JavaScript work or garbage collection.
- Low CPU with few major page faults points at synchronous disk I/O, such as SQLite reads or trace
  file writes.
- Many `involuntaryContextSwitches` mean other processes were competing for the CPU.

## Configure instrumentation

Use `vp run dev` with an isolated home for local development. Configure OTLP endpoints in the server environment and restart the server after changing them.

### Env Vars

Local trace file:

- `MADAR_TRACE_FILE`: override trace file path
- `MADAR_TRACE_MAX_BYTES`: per-file rotation size, default `10485760`
- `MADAR_TRACE_MAX_FILES`: rotated file count, default `10`
- `MADAR_TRACE_BATCH_WINDOW_MS`: flush window, default `1000`
- `MADAR_TRACE_MIN_LEVEL`: minimum trace level, default `Info`
- `MADAR_TRACE_TIMING_ENABLED`: enable timing metadata, default `true`

OTLP export:

- `MADAR_OTLP_TRACES_URL`: OTLP trace endpoint
- `MADAR_OTLP_METRICS_URL`: OTLP metric endpoint
- `MADAR_OTLP_LOGS_URL`: OTLP log endpoint
- `MADAR_OTLP_EXPORT_INTERVAL_MS`: export interval, default `10000`
- `MADAR_OTLP_HEADERS`: extra headers for all three exporters, same format as
  `OTEL_EXPORTER_OTLP_HEADERS`: comma-separated `key=value` pairs with percent-encoded values.
- `MADAR_OTLP_PROTOCOL`: `http/json` (default) or `http/protobuf`

The server and the desktop app also read the standard
`OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT` and generic `OTEL_EXPORTER_OTLP_ENDPOINT` (with
`/v1/traces`, `/v1/metrics`, or `/v1/logs` appended), for a collector expecting those instead. A
non-blank `MADAR_OTLP_*_URL` wins over either, and a per-signal endpoint wins over the generic one
for its signal. A blank value counts as unset. A signal with an OTEL endpoint takes its headers from
`OTEL_EXPORTER_OTLP_HEADERS` and its protocol from `OTEL_EXPORTER_OTLP_PROTOCOL` (default
`http/protobuf`, read case-insensitively), and a per-signal
`OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_HEADERS` or `_PROTOCOL` wins over the generic one for its
signal. `MADAR_OTLP_HEADERS` and `MADAR_OTLP_PROTOCOL` never apply to it. An endpoint that is not
an `http` or `https` URL, a protocol other than `http/protobuf` or `http/json` such as `grpc`, or
headers that are not `key=value` pairs with percent-encoded values turn that signal's export off
with a startup warning, rather than sending it to the Settings endpoint.

Service names are fixed: `madar-server` for the backend and `madar-desktop` for the desktop main
process, both in `service.namespace` `madar`. `OTEL_SERVICE_NAME` and a `service.name` or
`service.namespace` in `OTEL_RESOURCE_ATTRIBUTES` are ignored. Tell installations apart with other
resource attributes, such as `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=development`.
The UI reports `deployment.environment.name` from its build: `development` under the Vite dev server
and `production` otherwise.

Attributes specific to Madar use the `madar.` prefix. The UI runs as `madar-web` in both a
browser and the desktop window, since it is the same code, and `madar.client.surface` is `desktop`
or `web`. The server's `madar.server.managed_by` is `desktop` when the desktop app launched it and
`standalone` otherwise.

If the OTLP URLs are unset, local tracing still works, metrics stay in-process only, and logs stay
on stdout only.

### The Kill Switch

`MADAR_OTEL_SDK_DISABLED` and `OTEL_SDK_DISABLED` turn off every OTLP export in both the server and
the desktop main process, overriding any endpoint from the environment or Settings. Local trace
files and stdout logs are unaffected.

`MADAR_OTEL_SDK_DISABLED` wins when set, so `MADAR_OTEL_SDK_DISABLED=false` re-enables export on a
machine that sets `OTEL_SDK_DISABLED` for everything else. It accepts the usual boolean spellings
(`true`/`false`, `yes`/`no`, `on`/`off`, `1`/`0`, `y`/`n`). `OTEL_SDK_DISABLED` follows the
OpenTelemetry specification and only `true` disables export, so `OTEL_SDK_DISABLED=1` does not.
Values are case-insensitive and trimmed. An unrecognized value is ignored with a startup warning.

`OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, or `OTEL_LOGS_EXPORTER` set to `none` turns off
just that signal, overriding an OTEL endpoint and the Settings endpoint. A `MADAR_OTLP_*_URL` still
wins for its signal. `otlp` is the default, and any other exporter name, such as `console` or
`prometheus`, is ignored with a startup warning.

## Heap snapshots

To see what a long-running server holds in memory, send it `SIGUSR2`. The server writes a V8 heap
snapshot to its logs dir and logs the path. This works for desktop, `npx madar`, and service installs
on macOS and Linux. Windows has no `SIGUSR2`.

Send the signal to the server pid in `server-runtime.json`, which sits in the server's state dir
next to the `logs` dir. For a dev server or a `--home-dir` launch, use that server's state dir from
[Traces](#traces). Do not send it to the desktop app or the service launcher: a process without the
handler exits on `SIGUSR2`. After a crash the file can keep a stale pid that now belongs to a
different process, so check the pid first.

```bash
pid="$(jq .pid "${MADAR_HOME:-$HOME/.madar}/userdata/server-runtime.json")"
ps -p "$pid" -o command=
```

If `ps` shows the Madar server, send the signal:

```bash
kill -USR2 "$pid"
```

The file is `<logsDir>/server-<pid>-<timestamp>.heapsnapshot`, next to `server.trace.ndjson`. To
open it, use the Memory tab in Chrome DevTools and select Load.

Before you take one:

- The server stops while it writes the file. For a large heap this can take a minute or more.
  Connected clients can reconnect during the pause, and an event loop monitor, if the server has
  one, records the pause as a stall. Send the signal once. A second signal sent during a write
  takes another snapshot after the first one finishes.
- The write needs about as much free memory as the heap uses. On a machine that is already
  swapping, it can make the problem worse or crash the server.
- The file contains everything in server memory, including tokens, secrets, and application data. Do
  not share it publicly. Delete it when you are done, because storage cleanup does not remove it.
