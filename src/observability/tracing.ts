import type { Tracer } from "@opentelemetry/api";

import { trace } from "@opentelemetry/api";

// TODO: set the version of the tracer by env var?
const APP_TRACER_NAME = "observability-test";
const APP_TRACER_VERSION = "1.0.0";

/**
 * provides a centralized tracer for the application.
 * this should be used everywhere everywhere instead of trace.getTracer()
 * @returns a tracer for the application
 */
export function getAppTracer(): Tracer {
	return trace.getTracer(APP_TRACER_NAME, APP_TRACER_VERSION);
}
