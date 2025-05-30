import opentelemetry from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	BatchLogRecordProcessor,
	LoggerProvider,
} from "@opentelemetry/sdk-logs";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

// TODO: set the version of the service by env var
const resource = resourceFromAttributes({
	[ATTR_SERVICE_NAME]: "observability-test",
	[ATTR_SERVICE_VERSION]: "0.0.1",
});

// TODO: set the version of the service by env var
const traceExporter = new OTLPTraceExporter({
	url: "http://localhost:4318/v1/traces", // URL OTLP per tracce
});

// TODO: set the version of the service by env var
const metricExporter = new OTLPMetricExporter({
	url: "http://localhost:4318/v1/metrics", // URL OTLP per metriche
});

const metricReader = new PeriodicExportingMetricReader({
	exporter: metricExporter,
	exportIntervalMillis: 1000,
});

const meterProvider = new MeterProvider({
	resource: resource,
	readers: [metricReader],
});

const sdk = new NodeSDK({
	resource,
	traceExporter,
	// metricReader,
	instrumentations: [getNodeAutoInstrumentations()],
});

opentelemetry.metrics.setGlobalMeterProvider(meterProvider);

console.log("####Starting OpenTelemetry SDK");

sdk.start();

// TODO: set the version of the service by env var
const logExporter = new OTLPLogExporter({
	url: "http://localhost:4318/v1/logs",
});

const loggerProvider = new LoggerProvider({ resource });
loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(logExporter));

await loggerProvider
	.forceFlush()
	.then(() => console.log("🟢 LoggerProvider initialized"))
	.catch((err) => console.error("❌ LoggerProvider failed", err));

process.on("SIGTERM", async () => {
	await sdk.shutdown().catch(console.error);
	await loggerProvider.shutdown().catch(console.error);
});
