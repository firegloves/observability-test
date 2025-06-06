import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
	withActiveSpanWithContext,
	extractCustomSpanAttributes,
} from "../../../observability/spanHelper";
import {
	getMeterCounter,
	getMeterHistogram,
} from "../../../observability/metricHelper";
import {
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
} from "../../types";

// Metrics for tracing test endpoint
const tracingTestCounter = getMeterCounter(
	"tracing_test_requests_total",
	"Total number of tracing test requests",
);

const tracingAttributeHistogram = getMeterHistogram(
	"tracing_attribute_extraction_seconds",
	"Time taken to extract custom attributes",
);

// Request schema for tracing test
const TracingTestRequestSchema = z.object({
	operation_type: z
		.enum([
			"user_authentication",
			"data_processing",
			"external_api_call",
			"database_query",
			"cache_operation",
		])
		.default("data_processing"),
	test_payload: z
		.object({
			size: z.number().min(1).max(1000).default(100),
			complexity: z.enum(["simple", "medium", "complex"]).default("medium"),
			simulate_processing_time: z.boolean().default(true),
		})
		.optional(),
	custom_metadata: z.record(z.string(), z.any()).optional(),
});

// Response schemas
const TracingTestSuccessResponseSchema = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend(
	{
		data: z.object({
			operation_type: z.string(),
			execution_time_ms: z.number(),
			extracted_attributes: z.record(z.string(), z.any()),
			span_context: z.object({
				trace_id: z.string().optional(),
				span_id: z.string().optional(),
				has_custom_attributes: z.boolean(),
			}),
			user_context: z.object({
				user_id: z.string().optional(),
				session_id: z.string().optional(),
				test_context: z.string().optional(),
			}),
			metadata: z.object({
				timestamp: z.string(),
				attributes_count: z.number(),
				processing_duration_ms: z.number(),
			}),
		}),
	},
);

const TracingTestErrorResponseSchema = z.discriminatedUnion("success", [
	TracingTestSuccessResponseSchema,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);

type TracingTestRequest = z.infer<typeof TracingTestRequestSchema>;
type TracingTestResponse = z.infer<typeof TracingTestErrorResponseSchema>;

// const REVIEW_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
// 	SUCCESS_REVIEW_RESPONSE_SCHEMA,
// 	GENERIC_ERROR_RESPONSE_SCHEMA,
// ]);
// type ReviewResponse = z.infer<typeof REVIEW_RESPONSE_SCHEMA>;

// Helper function to simulate operation processing
async function simulateOperation(
	operationType: string,
	testPayload?: TracingTestRequest["test_payload"],
): Promise<{ processingTime: number; result: any }> {
	const startTime = Date.now();

	// Simulate different processing times based on operation type
	const baseDelay =
		{
			user_authentication: 50,
			data_processing: 200,
			external_api_call: 300,
			database_query: 100,
			cache_operation: 10,
		}[operationType] || 100;

	const complexityMultiplier =
		testPayload?.complexity === "complex"
			? 2
			: testPayload?.complexity === "simple"
				? 0.5
				: 1;

	const delay = baseDelay * complexityMultiplier;

	if (testPayload?.simulate_processing_time !== false) {
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	const processingTime = Date.now() - startTime;

	// Generate mock result based on operation type
	const result = {
		operation: operationType,
		processed_items: testPayload?.size || 100,
		complexity_level: testPayload?.complexity || "medium",
		success: true,
	};

	return { processingTime, result };
}

const route: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	// Test endpoint for custom span attributes
	app.post(
		"/test-attributes",
		{
			schema: {
				body: TracingTestRequestSchema,
				response: {
					200: TracingTestSuccessResponseSchema,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<TracingTestResponse> => {
			const startTime = Date.now();
			const { operation_type, test_payload, custom_metadata } = request.body;

			try {
				// Increment request counter
				tracingTestCounter.add(1, {
					operation_type,
					has_custom_metadata: !!custom_metadata,
				});

				request.log.info({
					operation_type,
					test_payload,
					user_id: request.headers["x-user-id"],
					session_id: request.headers["x-user-session"],
					msg: "#### Processing tracing test request with custom attributes",
				});

				// Execute operation within enhanced span context
				const result = await withActiveSpanWithContext(
					`TracingTest.${operation_type}`,
					request,
					async (span) => {
						// Extract attributes at start of operation
						const attributeExtractionStart = Date.now();
						const extractedAttributes = extractCustomSpanAttributes(request);
						const attributeExtractionTime =
							Date.now() - attributeExtractionStart;

						// Record attribute extraction time
						tracingAttributeHistogram.record(attributeExtractionTime / 1000, {
							operation_type,
							attributes_count:
								Object.keys(extractedAttributes).length.toString(),
						});

						// Add operation-specific attributes
						span.setAttributes({
							"test.operation_type": operation_type,
							"test.payload_size": test_payload?.size || 0,
							"test.complexity": test_payload?.complexity || "medium",
							"test.custom_metadata_present": !!custom_metadata,
							"test.simulate_processing":
								test_payload?.simulate_processing_time !== false,
						});

						// Add custom metadata if provided
						if (custom_metadata) {
							for (const [key, value] of Object.entries(custom_metadata)) {
								span.setAttributes({
									[`custom.${key}`]: String(value),
								});
							}
						}

						// Add span event for operation start
						span.addEvent("operation_started", {
							operation_type,
							payload_size: test_payload?.size || 0,
							complexity: test_payload?.complexity || "medium",
						});

						// Simulate the actual operation
						const { processingTime, result: operationResult } =
							await simulateOperation(operation_type, test_payload);

						// Add span event for operation completion
						span.addEvent("operation_completed", {
							processing_time_ms: processingTime,
							success: true,
							processed_items: operationResult.processed_items,
						});

						// Get span context information
						const spanContext = span.spanContext();
						const spanInfo = {
							trace_id: spanContext.traceId,
							span_id: spanContext.spanId,
							has_custom_attributes:
								Object.keys(extractedAttributes).length > 0,
						};

						return {
							operationResult,
							extractedAttributes,
							spanInfo,
							attributeExtractionTime,
							processingTime,
						};
					},
					{
						// Additional attributes that can be added programmatically
						"endpoint.name": "test-attributes",
						"test.scenario": "custom_span_attributes_validation",
					},
				);

				const totalExecutionTime = Date.now() - startTime;

				// Extract user context from headers
				const userContext = {
					user_id: (request.headers["x-user-id"] as string) || undefined,
					session_id:
						(request.headers["x-user-session"] as string) || undefined,
					test_context:
						(request.headers["x-performance-test"] as string) ||
						(request.headers["x-database-test"] as string) ||
						(request.headers["x-cpu-test"] as string) ||
						undefined,
				};

				request.log.info({
					operation_type,
					execution_time_ms: totalExecutionTime,
					extracted_attributes: result.extractedAttributes,
					span_context: result.spanInfo,
					user_context: userContext,
					msg: "#### Tracing test completed successfully",
				});

				reply.status(200);
				return {
					success: true as const,
					data: {
						operation_type,
						execution_time_ms: totalExecutionTime,
						extracted_attributes: result.extractedAttributes,
						span_context: result.spanInfo,
						user_context: userContext,
						metadata: {
							timestamp: new Date().toISOString(),
							attributes_count: Object.keys(result.extractedAttributes).length,
							processing_duration_ms: result.processingTime,
						},
					},
				};
			} catch (error) {
				request.log.error({
					operation_type,
					error: error instanceof Error ? error.message : "Unknown error",
					execution_time_ms: Date.now() - startTime,
					msg: "#### Tracing test failed",
				});

				reply.status(500);
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Internal server error",
				} as const;
			}
		},
	);

	// Endpoint to demonstrate attribute inheritance in nested operations
	app.post(
		"/nested-operations",
		{
			schema: {
				body: z.object({
					parent_operation: z.string().default("parent_task"),
					child_operations: z
						.array(z.string())
						.default(["child_task_1", "child_task_2"]),
					depth: z.number().min(1).max(5).default(2),
				}),
				response: {
					200: GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
						data: z.object({
							parent_operation: z.string(),
							child_results: z.array(
								z.object({
									operation: z.string(),
									execution_time_ms: z.number(),
									attributes_inherited: z.boolean(),
								}),
							),
							total_execution_time_ms: z.number(),
							trace_hierarchy: z.object({
								parent_span_id: z.string().optional(),
								child_span_ids: z.array(z.string()).optional(),
							}),
						}),
					}),
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply) => {
			const startTime = Date.now();
			const { parent_operation, child_operations, depth } = request.body;

			try {
				const result = await withActiveSpanWithContext(
					`NestedTest.${parent_operation}`,
					request,
					async (parentSpan) => {
						const parentSpanContext = parentSpan.spanContext();
						const childResults: any[] = [];
						const childSpanIds: string[] = [];

						// Add parent operation attributes
						parentSpan.setAttributes({
							"nested.operation_type": "parent",
							"nested.child_count": child_operations.length,
							"nested.depth": depth,
						});

						// Execute child operations
						for (const [index, childOp] of child_operations.entries()) {
							const childResult = await withActiveSpanWithContext(
								`NestedChild.${childOp}`,
								request,
								async (childSpan) => {
									const childSpanContext = childSpan.spanContext();
									childSpanIds.push(childSpanContext.spanId);

									// Add child-specific attributes
									childSpan.setAttributes({
										"nested.operation_type": "child",
										"nested.parent_operation": parent_operation,
										"nested.child_index": index + 1,
										"nested.depth_level": 2,
									});

									// Simulate child operation
									const childStartTime = Date.now();
									await new Promise((resolve) =>
										setTimeout(resolve, 50 + index * 25),
									);
									const childExecutionTime = Date.now() - childStartTime;

									childSpan.addEvent("child_operation_completed", {
										child_operation: childOp,
										execution_time_ms: childExecutionTime,
										index: index + 1,
									});

									return {
										operation: childOp,
										execution_time_ms: childExecutionTime,
										attributes_inherited: true,
									};
								},
							);

							childResults.push(childResult);
						}

						parentSpan.addEvent("all_child_operations_completed", {
							child_count: child_operations.length,
							total_child_time_ms: childResults.reduce(
								(sum, r) => sum + r.execution_time_ms,
								0,
							),
						});

						return {
							parentSpanContext,
							childResults,
							childSpanIds,
						};
					},
				);

				const totalExecutionTime = Date.now() - startTime;

				reply.status(200);
				return {
					success: true as const,
					data: {
						parent_operation,
						child_results: result.childResults,
						total_execution_time_ms: totalExecutionTime,
						trace_hierarchy: {
							parent_span_id: result.parentSpanContext.spanId,
							child_span_ids: result.childSpanIds,
						},
					},
				};
			} catch (error) {
				reply.status(500);
				return {
					success: false,
					error:
						error instanceof Error ? error.message : "Internal server error",
				} as const;
			}
		},
	);
};

export default route;
