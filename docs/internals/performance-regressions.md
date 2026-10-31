# Performance constraints

Keep local trace writes asynchronous and serialized, with rotation. Batching synchronous writes
still blocks the server event loop on slow storage, especially on Windows. Keep the pending
trace buffer bounded so a stalled disk cannot consume unbounded memory. Shutdown must drain
accepted writes before closing their scope.

The trace writer lives in [shared observability](../../packages/shared/src/observability.ts).
Use the [observability runbook](../operations/observability.md) to inspect local traces.
