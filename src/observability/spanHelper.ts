import {
	type Span,
	type SpanOptions,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import {
	SEMATTRS_CODE_FILEPATH,
	SEMATTRS_CODE_FUNCTION,
	SEMATTRS_HTTP_METHOD,
	SEMATTRS_HTTP_ROUTE,
} from "@opentelemetry/semantic-conventions";
import { getAppTracer } from "./tracing";

/**
 * Extract custom span attributes from Fastify request
 * This enhances tracing with user context and operation metadata
 */
export function extractCustomSpanAttributes(
	request: any,
): Record<string, string | number | boolean> {
	const attributes: Record<string, string | number | boolean> = {};

	// Extract user_id from headers or request context
	const userId = request.headers["x-user-id"] || request.headers["user-id"];
	if (userId) {
		attributes["user.id"] = userId;
		attributes["user.session"] = request.headers["x-user-session"] || "unknown";
	}

	// Extract operation_type from request body or headers
	const operationType =
		request.body?.operation_type ||
		request.body?.computation_type ||
		request.body?.timeout_type ||
		request.body?.error_type ||
		request.body?.failure_type ||
		request.headers["x-operation-type"];
	if (operationType) {
		attributes["operation.type"] = operationType;
	}

	// Extract additional context from headers
	const testContext =
		request.headers["x-performance-test"] ||
		request.headers["x-database-test"] ||
		request.headers["x-cpu-test"];
	if (testContext) {
		attributes["test.context"] = testContext;
	}

	// Add request metadata
	if (request.method) {
		attributes[SEMATTRS_HTTP_METHOD] = request.method;
	}
	if (request.routerPath) {
		attributes[SEMATTRS_HTTP_ROUTE] = request.routerPath;
	}
	if (request.url) {
		attributes["http.url"] = request.url;
	}
	if (request.ip) {
		attributes["http.client_ip"] = request.ip;
	}

	// Add request ID if available
	const requestId = request.id || request.headers["x-request-id"];
	if (requestId) {
		attributes["request.id"] = requestId;
	}

	return attributes;
}

/**
 * Executes a function within an active OpenTelemetry span with custom attributes.
 *
 * This utility function creates a new span, executes the provided function within that span,
 * and properly handles any errors by recording them as span events.
 *
 * @param name - The name of the span to create
 * @param fn - The function to execute within the span. The span is passed as an argument.
 * @param options - Optional configuration
 * @param options.tracerName - Custom tracer name to use instead of the default
 * @param options.attributes - Additional attributes to set on the span
 * @returns A promise that resolves to the return value of the provided function
 */
export async function withActiveSpanWithAttributes<T>(
	name: string,
	options: Pick<SpanOptions, "attributes"> & {
		tracerName?: string;
		tracerVersion?: string;
	},
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	// get the tracer
	const tracer = options?.tracerName
		? trace.getTracer(options.tracerName, options.tracerVersion)
		: getAppTracer();

	// create the span
	return tracer.startActiveSpan(
		name,
		{ attributes: options?.attributes },
		async (span) => {
			try {
				// execute the function
				return await fn(span);
			} catch (err: unknown) {
				// handle errors
				if (err instanceof Error) {
					span.recordException(err);
					span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
				} else {
					span.recordException({ name: "UnknownError", message: String(err) });
					span.setStatus({
						code: SpanStatusCode.ERROR,
						message: "Unknown error",
					});
				}
				throw err;
			} finally {
				// end the span
				span.end();
			}
		},
	);
}

/**
 * Executes a function within an active OpenTelemetry span with automatic custom attributes extraction.
 *
 * This version automatically extracts user_id, operation_type and other context from the request.
 *
 * @param name - The name of the span to create
 * @param request - Fastify request object for extracting custom attributes
 * @param fn - The function to execute within the span
 * @param additionalAttributes - Additional custom attributes to merge
 */
export async function withActiveSpanWithContext<T>(
	name: string,
	request: any,
	fn: (span: Span) => Promise<T>,
	additionalAttributes: Record<string, string | number | boolean> = {},
): Promise<T> {
	const customAttributes = extractCustomSpanAttributes(request);
	const mergedAttributes = { ...customAttributes, ...additionalAttributes };

	return withActiveSpanWithAttributes(
		name,
		{ attributes: mergedAttributes },
		fn,
	);
}

/**
 * Executes a function within an active OpenTelemetry span.
 *
 * This utility function creates a new span, executes the provided function within that span,
 * and properly handles any errors by recording them as span events.
 *
 * @param name - The name of the span to create
 * @param fn - The function to execute within the span. The span is passed as an argument.
 * @returns A promise that resolves to the return value of the provided function
 */
export async function withActiveSpan<T>(
	name: string,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	return withActiveSpanWithAttributes(name, {}, fn);
}

/**
 * Decorator that automatically wraps a method with an OpenTelemetry span.
 *
 * This decorator creates a span around the decorated method, automatically capturing
 * the class name and method name as attributes. It properly handles errors and ensures
 * the span is ended when the method completes.
 *
 * @param explicitSpanName - Optional custom name for the span. If not provided,
 *                          defaults to `ClassName.methodName`
 * @returns A method decorator that wraps the original method with tracing functionality
 *
 * @example
 * ```typescript
 * class UserService {
 *   @TraceMethod()
 *   async findUser(id: string) {
 *     // Method implementation
 *   }
 *
 *   @TraceMethod("CustomSpanName")
 *   async createUser(userData: UserData) {
 *     // Method implementation
 *   }
 * }
 * ```
 */
export function TraceMethod(explicitSpanName?: string) {
	return (
		target: unknown,
		propertyKey: string,
		descriptor: PropertyDescriptor,
	) => {
		// ensure the decorator has been applied to a method
		if (typeof descriptor.value !== "function") {
			throw new Error(
				`@TraceMethod can only be applied to methods. "${propertyKey}" is not a method.`,
			);
		}

		const className = target?.constructor?.name || "UnknownClass";
		const spanName = explicitSpanName || `${className}.${propertyKey}`;
		const originalMethod = descriptor.value;

		descriptor.value = async function (...args: unknown[]) {
			// set fixed attributes
			const attributes = {
				[SEMATTRS_CODE_FILEPATH]: className,
				[SEMATTRS_CODE_FUNCTION]: propertyKey,
			};

			// execute the method within a span
			return withActiveSpanWithAttributes(
				spanName,
				{ attributes },
				async (_) => await originalMethod.apply(this, args),
			);
		};

		return descriptor;
	};
}
