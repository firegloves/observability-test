import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { trace } from "@opentelemetry/api";
import { extractCustomSpanAttributes } from "./spanHelper";

/**
 * Fastify plugin that enhances OpenTelemetry tracing with custom attributes
 * Automatically adds user_id, operation_type, and other contextual information to spans
 */
const tracingEnhancementPlugin: FastifyPluginAsync = async (fastify) => {
	// Hook into every request to enhance the active span
	fastify.addHook("onRequest", async (request, reply) => {
		const activeSpan = trace.getActiveSpan();

		if (activeSpan) {
			// Extract custom attributes from the request
			const customAttributes = extractCustomSpanAttributes(request);

			// Add custom attributes to the active span
			activeSpan.setAttributes(customAttributes);

			// Add span event to track when custom attributes were applied
			activeSpan.addEvent("custom_attributes_applied", {
				attributes_count: Object.keys(customAttributes).length,
				has_user_id: !!customAttributes["user.id"],
				has_operation_type: !!customAttributes["operation.type"],
			});

			// Log for debugging
			fastify.log.debug({
				span_id: (activeSpan as any).spanContext?.()?.spanId,
				custom_attributes: customAttributes,
				msg: "#### Enhanced span with custom attributes",
			});
		}
	});

	// Hook to add operation timing information
	fastify.addHook("onResponse", async (request, reply) => {
		const activeSpan = trace.getActiveSpan();

		if (activeSpan) {
			// Add response information to span
			activeSpan.setAttributes({
				"http.status_code": reply.statusCode,
				"http.response_size": reply.getHeader("content-length") || 0,
			});

			// Add operation completion event
			activeSpan.addEvent("request_completed", {
				status_code: reply.statusCode,
				response_time_ms: reply.elapsedTime || 0,
			});
		}
	});

	// Hook to handle errors in spans
	fastify.addHook("onError", async (request, reply, error) => {
		const activeSpan = trace.getActiveSpan();

		if (activeSpan) {
			// Record the error in the span
			activeSpan.recordException(error);
			activeSpan.setAttributes({
				"error.name": error.name,
				"error.message": error.message,
				"error.stack": error.stack || "",
			});

			activeSpan.addEvent("error_occurred", {
				error_type: error.constructor.name,
				error_message: error.message,
			});
		}
	});
};

export default fp(tracingEnhancementPlugin, {
	name: "tracing-enhancement-plugin",
	dependencies: [],
});
