import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { trace, metrics } from "@opentelemetry/api";
import {
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
} from "../../types";

// Create tracer and metrics for error scenarios
const tracer = trace.getTracer("error-scenarios", "1.0.0");
const meter = metrics.getMeter("error-scenarios", "1.0.0");

// Metrics
const errorScenarioRequests = meter.createCounter(
	"error_scenario_requests_total",
	{
		description: "Total number of error scenario requests",
	},
);

const errorScenarioErrors = meter.createCounter("error_scenario_errors_total", {
	description: "Total number of error scenario errors by type",
});

const errorRecoveryTime = meter.createHistogram("error_recovery_time_seconds", {
	description: "Time taken to handle/recover from errors",
	unit: "s",
});

// Error simulation configurations
const ERROR_SCENARIOS = {
	connection_timeout: {
		name: "Database Connection Timeout",
		delay_ms: 8000, // Simulate 8s timeout
		success_rate: 0.1, // 90% failure rate
		error_code: "ECONNRESET",
		description: "Database connection timeout simulation",
	},
	connection_refused: {
		name: "Database Connection Refused",
		delay_ms: 100,
		success_rate: 0.05, // 95% failure rate
		error_code: "ECONNREFUSED",
		description: "Database connection refused simulation",
	},
	deadlock: {
		name: "Database Deadlock",
		delay_ms: 2000,
		success_rate: 0.3, // 70% failure rate
		error_code: "DEADLOCK_DETECTED",
		description: "Database deadlock simulation",
	},
	pool_exhaustion: {
		name: "Connection Pool Exhaustion",
		delay_ms: 5000,
		success_rate: 0.2, // 80% failure rate
		error_code: "POOL_EXHAUSTED",
		description: "Database connection pool exhaustion",
	},
	network_partition: {
		name: "Network Partition",
		delay_ms: 15000, // Long timeout
		success_rate: 0.0, // 100% failure rate
		error_code: "NETWORK_UNREACHABLE",
		description: "Network partition between app and database",
	},
} as const;

type ErrorScenarioType = keyof typeof ERROR_SCENARIOS;

// Request schema
const DATABASE_ERROR_REQUEST_SCHEMA = z.object({
	error_type: z.enum([
		"connection_timeout",
		"connection_refused",
		"deadlock",
		"pool_exhaustion",
		"network_partition",
	]),
	force_error: z.boolean().optional().default(false),
	retry_attempts: z.number().min(0).max(5).optional().default(2),
	operation_context: z
		.enum(["user_query", "background_job", "migration", "health_check"])
		.optional()
		.default("user_query"),
});

// Response schemas
const DATABASE_ERROR_SUCCESS_DATA_SCHEMA = z.object({
	error_type: z.string(),
	scenario_name: z.string(),
	execution_time_ms: z.number(),
	operation_context: z.string(),
	recovery_strategy: z.string(),
	retry_attempts: z.number(),
	final_success: z.boolean(),
	timestamp: z.string(),
	metadata: z.object({
		simulated_delay_ms: z.number(),
		success_probability: z.number(),
		error_code: z.string(),
		recovery_time_ms: z.number(),
	}),
});

const DATABASE_ERROR_FAILURE_SCHEMA = GENERIC_ERROR_RESPONSE_SCHEMA.extend({
	error_details: z
		.object({
			error_type: z.string(),
			error_code: z.string(),
			retry_attempts: z.number(),
			total_time_ms: z.number(),
			context: z.string(),
		})
		.optional(),
});

const DATABASE_ERROR_SUCCESS_SCHEMA = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: DATABASE_ERROR_SUCCESS_DATA_SCHEMA,
});

const DATABASE_ERROR_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	DATABASE_ERROR_SUCCESS_SCHEMA,
	DATABASE_ERROR_FAILURE_SCHEMA,
]);

const SCENARIOS_LIST_DATA_SCHEMA = z.object({
	scenarios: z.array(
		z.object({
			error_type: z.string(),
			name: z.string(),
			description: z.string(),
			delay_ms: z.number(),
			success_rate: z.number(),
			error_code: z.string(),
		}),
	),
	total_scenarios: z.number(),
});

const SCENARIOS_LIST_SUCCESS_SCHEMA = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: SCENARIOS_LIST_DATA_SCHEMA,
});

const SCENARIOS_LIST_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SCENARIOS_LIST_SUCCESS_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);

// Type definitions
type DatabaseErrorRequest = z.infer<typeof DATABASE_ERROR_REQUEST_SCHEMA>;
type DatabaseErrorResponse = z.infer<typeof DATABASE_ERROR_RESPONSE_SCHEMA>;
type ScenariosListResponse = z.infer<typeof SCENARIOS_LIST_RESPONSE_SCHEMA>;

// Helper function to simulate database operations
async function simulateDatabaseOperation(
	errorType: ErrorScenarioType,
	forceError: boolean,
	retryAttempts: number,
	context: string,
	logger: any,
): Promise<{
	success: boolean;
	executionTime: number;
	recoveryTime: number;
	finalAttempts: number;
	error?: {
		code: string;
		message: string;
	};
}> {
	const scenario = ERROR_SCENARIOS[errorType];
	const startTime = Date.now();
	let currentAttempts = 0;
	let lastError: { code: string; message: string } | undefined;

	const span = tracer.startSpan(`DatabaseError.${errorType}`, {
		attributes: {
			"error.type": errorType,
			"error.scenario": scenario.name,
			"operation.context": context,
			"operation.force_error": forceError,
			"operation.max_retries": retryAttempts,
		},
	});

	try {
		// Retry loop
		for (let attempt = 0; attempt <= retryAttempts; attempt++) {
			currentAttempts = attempt + 1;
			const attemptSpan = tracer.startSpan(
				`DatabaseError.attempt_${attempt + 1}`,
				{
					attributes: {
						"retry.attempt": attempt + 1,
						"retry.max_attempts": retryAttempts + 1,
					},
				},
			);

			try {
				// Simulate operation delay
				await new Promise((resolve) => setTimeout(resolve, scenario.delay_ms));

				// Determine if this attempt should succeed or fail
				const shouldSucceed =
					!forceError && Math.random() < scenario.success_rate;

				if (shouldSucceed) {
					// Success case
					attemptSpan.setAttributes({
						"operation.result": "success",
						"operation.attempt_duration_ms": scenario.delay_ms,
					});
					attemptSpan.addEvent("database_operation_succeeded", {
						attempt: attempt + 1,
						recovery_strategy: "retry_success",
					});
					attemptSpan.end();

					const totalTime = Date.now() - startTime;
					span.setAttributes({
						"operation.result": "success",
						"operation.total_attempts": currentAttempts,
						"operation.total_duration_ms": totalTime,
					});
					span.addEvent("error_scenario_completed", {
						final_result: "success",
						total_attempts: currentAttempts,
					});

					return {
						success: true,
						executionTime: totalTime,
						recoveryTime: totalTime - scenario.delay_ms,
						finalAttempts: currentAttempts,
					};
				}

				// Failure case
				lastError = {
					code: scenario.error_code,
					message: `${scenario.description} (attempt ${attempt + 1})`,
				};

				attemptSpan.setAttributes({
					"operation.result": "error",
					"error.code": lastError.code,
					"error.message": lastError.message,
				});
				attemptSpan.recordException(new Error(lastError.message));
				attemptSpan.addEvent("database_operation_failed", {
					attempt: attempt + 1,
					error_code: lastError.code,
					will_retry: attempt < retryAttempts,
				});
				attemptSpan.end();

				logger.warn({
					error_type: errorType,
					error_code: lastError.code,
					attempt: attempt + 1,
					max_retries: retryAttempts,
					context,
					msg: `Database operation failed: ${lastError.message}`,
				});

				// If this isn't the last attempt, add a small delay before retry
				if (attempt < retryAttempts) {
					const retryDelay = Math.min(1000 * 2 ** attempt, 5000); // Exponential backoff, max 5s
					await new Promise((resolve) => setTimeout(resolve, retryDelay));
				}
			} catch (error) {
				attemptSpan.recordException(error as Error);
				attemptSpan.setStatus({ code: 2, message: (error as Error).message });
				attemptSpan.end();
				throw error;
			}
		}

		// All attempts failed
		const totalTime = Date.now() - startTime;
		span.setAttributes({
			"operation.result": "error",
			"operation.total_attempts": currentAttempts,
			"operation.total_duration_ms": totalTime,
			"error.final_code": lastError?.code || "UNKNOWN",
		});
		span.addEvent("error_scenario_failed", {
			final_result: "error",
			total_attempts: currentAttempts,
			final_error: lastError?.code || "UNKNOWN",
		});

		return {
			success: false,
			executionTime: totalTime,
			recoveryTime: totalTime,
			finalAttempts: currentAttempts,
			error: lastError,
		};
	} finally {
		span.end();
	}
}

const errorsRoute: FastifyPluginAsync = async (fastify) => {
	// Database connection errors endpoint
	fastify.post<{
		Body: DatabaseErrorRequest;
		Reply: DatabaseErrorResponse;
	}>(
		"/database",
		{
			schema: {
				summary: "Simulate database connection errors",
				description:
					"Simulates various database connection error scenarios for testing error handling and observability",
				tags: ["Error Scenarios"],
				body: DATABASE_ERROR_REQUEST_SCHEMA,
				response: {
					200: DATABASE_ERROR_SUCCESS_SCHEMA,
					500: DATABASE_ERROR_FAILURE_SCHEMA,
				},
			},
		},
		async (request, reply) => {
			const {
				error_type,
				force_error = false,
				retry_attempts = 2,
				operation_context = "user_query",
			} = request.body;

			const requestId = crypto.randomUUID();
			const scenario = ERROR_SCENARIOS[error_type];

			// Record metrics
			errorScenarioRequests.add(1, {
				error_type,
				operation_context,
				force_error: force_error.toString(),
			});

			const span = tracer.startSpan("ErrorScenario.database_error", {
				attributes: {
					"http.method": "POST",
					"http.route": "/v1/errors/database",
					"endpoint.name": "database_errors",
					"test.scenario": "error_simulation",
					"error.type": error_type,
					"error.scenario": scenario.name,
					"operation.context": operation_context,
					"request.id": requestId,
				},
			});

			try {
				fastify.log.info({
					request_id: requestId,
					error_type,
					scenario_name: scenario.name,
					force_error,
					retry_attempts,
					operation_context,
					msg: `#### Starting database error simulation: ${scenario.name}`,
				});

				span.addEvent("error_simulation_started", {
					error_type,
					scenario: scenario.name,
					force_error,
					max_retries: retry_attempts,
				});

				const recoveryStartTime = Date.now();

				const result = await simulateDatabaseOperation(
					error_type,
					force_error,
					retry_attempts,
					operation_context,
					fastify.log,
				);

				const recoveryTime = (Date.now() - recoveryStartTime) / 1000;

				// Record recovery time metric
				errorRecoveryTime.record(recoveryTime, {
					error_type,
					operation_context,
					success: result.success.toString(),
				});

				if (result.success) {
					// Success response
					span.setAttributes({
						"operation.result": "success",
						"operation.total_attempts": result.finalAttempts,
						"operation.execution_time_ms": result.executionTime,
						"operation.recovery_time_ms": result.recoveryTime,
					});

					span.addEvent("error_scenario_resolved", {
						final_result: "success",
						total_attempts: result.finalAttempts,
						recovery_strategy: "retry_success",
					});

					fastify.log.info({
						request_id: requestId,
						error_type,
						execution_time_ms: result.executionTime,
						recovery_time_ms: result.recoveryTime,
						total_attempts: result.finalAttempts,
						msg: "#### Database error simulation resolved successfully",
					});

					return reply.code(200).send({
						success: true,
						data: {
							error_type,
							scenario_name: scenario.name,
							execution_time_ms: result.executionTime,
							operation_context,
							recovery_strategy: "retry_success",
							retry_attempts: result.finalAttempts,
							final_success: true,
							timestamp: new Date().toISOString(),
							metadata: {
								simulated_delay_ms: scenario.delay_ms,
								success_probability: scenario.success_rate,
								error_code: scenario.error_code,
								recovery_time_ms: result.recoveryTime,
							},
						},
					});
				}

				// Error response - all retries failed
				errorScenarioErrors.add(1, {
					error_type,
					error_code: result.error?.code || "UNKNOWN",
					operation_context,
				});

				span.setAttributes({
					"operation.result": "error",
					"operation.total_attempts": result.finalAttempts,
					"operation.execution_time_ms": result.executionTime,
					"error.code": result.error?.code || "UNKNOWN",
					"error.message": result.error?.message || "Unknown error",
				});

				span.recordException(
					new Error(result.error?.message || "Database operation failed"),
				);
				span.addEvent("error_scenario_failed", {
					final_result: "error",
					total_attempts: result.finalAttempts,
					final_error_code: result.error?.code || "UNKNOWN",
				});

				fastify.log.error({
					request_id: requestId,
					error_type,
					error_code: result.error?.code,
					error_message: result.error?.message,
					total_attempts: result.finalAttempts,
					execution_time_ms: result.executionTime,
					msg: `#### Database error simulation failed: ${result.error?.message}`,
				});

				return reply.code(500).send({
					success: false,
					error: `Database error simulation failed: ${result.error?.message}`,
					error_details: {
						error_type,
						error_code: result.error?.code || "UNKNOWN",
						retry_attempts: result.finalAttempts,
						total_time_ms: result.executionTime,
						context: operation_context,
					},
				});
			} catch (error) {
				// Unexpected error
				errorScenarioErrors.add(1, {
					error_type,
					error_code: "UNEXPECTED",
					operation_context,
				});

				span.recordException(error as Error);
				span.setStatus({ code: 2, message: (error as Error).message });

				fastify.log.error({
					request_id: requestId,
					error_type,
					error: error,
					msg: "#### Unexpected error in database error simulation",
				});

				return reply.code(500).send({
					success: false,
					error: `Unexpected error in database error simulation: ${(error as Error).message}`,
				});
			} finally {
				span.end();
			}
		},
	);

	// List available error scenarios
	fastify.get<{
		Reply: ScenariosListResponse;
	}>(
		"/database/scenarios",
		{
			schema: {
				summary: "List available database error scenarios",
				description:
					"Returns a list of all available database error scenarios for testing",
				tags: ["Error Scenarios"],
				response: {
					200: SCENARIOS_LIST_SUCCESS_SCHEMA,
				},
			},
		},
		async (request, reply) => {
			const scenarios = Object.entries(ERROR_SCENARIOS).map(([key, value]) => ({
				error_type: key,
				name: value.name,
				description: value.description,
				delay_ms: value.delay_ms,
				success_rate: value.success_rate,
				error_code: value.error_code,
			}));

			return reply.code(200).send({
				success: true,
				data: {
					scenarios,
					total_scenarios: scenarios.length,
				},
			});
		},
	);
};

export default errorsRoute;
