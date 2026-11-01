import * as Metric from "effect/Metric";

// OTLP carries the unit, and Prometheus names the series by it: a unitless gauge gains `_ratio`.
export const serverResidentBytes = Metric.gauge("madar_server_resident_bytes", {
  description: "Resident memory of the server process.",
  attributes: { unit: "By" },
});

export const serverHeapUsedBytes = Metric.gauge("madar_server_heap_used_bytes", {
  description: "JavaScript heap in use by the server process.",
  attributes: { unit: "By" },
});

export const serverCpuUtilization = Metric.gauge("madar_server_cpu_utilization", {
  description: "CPU time the server used per second over the last sample; 1 is one full core.",
});

export const serverEventLoopUtilization = Metric.gauge("madar_server_event_loop_utilization", {
  description: "Share of the last sample the server's event loop spent busy.",
});

export const serverEventLoopDelayMax = Metric.gauge("madar_server_event_loop_delay_max", {
  description: "Longest event loop delay over the last sample.",
  attributes: { unit: "ms" },
});
