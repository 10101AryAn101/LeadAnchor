/**
 * Observability (spec §6, "real tracing from day one"): OpenTelemetry traces for requests and
 * provider webhooks, database queries, outgoing calls to providers and background jobs. Loaded
 * before the app (node --import), and only switched on when somewhere to send traces is set:
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   any OTLP backend (Jaeger, Grafana, Honeycomb…)
 *   OTEL_TRACES_EXPORTER=console                         print spans in the API's terminal
 *
 * With neither set it does nothing, so the app runs exactly as without it.
 */
import { existsSync, readFileSync } from "node:fs";
import { register } from "node:module";

// The app reads .env itself, later; only the OTEL_ settings are needed this early.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const match = /^(OTEL_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (match && process.env[match[1]!] === undefined) process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_TRACES_EXPORTER === "console") {
  // ES modules are instrumented through this loader hook.
  register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);
  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { getNodeAutoInstrumentations } = await import("@opentelemetry/auto-instrumentations-node");
  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME ?? "leadanchor-api",
    instrumentations: [
      getNodeAutoInstrumentations({
        // Noise: every file read and socket would be a span.
        "@opentelemetry/instrumentation-fs": { enabled: false },
        "@opentelemetry/instrumentation-dns": { enabled: false },
        "@opentelemetry/instrumentation-net": { enabled: false },
      }),
    ],
  });
  sdk.start();
  const stop = () => void sdk.shutdown().catch(() => undefined);
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
