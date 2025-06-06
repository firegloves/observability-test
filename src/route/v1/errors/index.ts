import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { trace, metrics } from "@opentelemetry/api";
import {
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
} from "../../types";
import type { FastifyBaseLogger } from "fastify";
import { randomBytes } from "crypto";

// Create tracer and metrics for error scenarios
const tracer = trace.getTracer("error-scenarios", "1.0.0");
const meter = metrics.getMeter("error-scenarios", "1.0.0");

// Database Error Metrics
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

// Timeout Scenario Metrics
const timeoutScenarioRequestsCounter = meter.createCounter(
	"timeout_scenario_requests_total",
	{
		description: "Total timeout scenario requests",
	},
);

const timeoutScenarioErrorsCounter = meter.createCounter(
	"timeout_scenario_errors_total",
	{
		description: "Total timeout scenario failures",
	},
);

const timeoutDurationHistogram = meter.createHistogram(
	"timeout_duration_seconds",
	{
		description: "Timeout duration distribution",
		unit: "s",
	},
);

const circuitBreakerStateGauge = meter.createUpDownCounter(
	"circuit_breaker_state",
	{
		description: "Circuit breaker state (0=closed, 1=open, 2=half-open)",
	},
);

// =============================================================================
// DATABASE ERROR SCENARIOS
// =============================================================================

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

// =============================================================================
// TIMEOUT SCENARIOS CONFIGURATIONS
// =============================================================================

const TIMEOUT_SCENARIOS = {
	client_timeout: {
		name: "Client Request Timeout",
		description:
			"Simulates client-side request timeout (client gives up waiting)",
		timeout_ms: 5000,
		success_rate: 0.2, // 20% success rate (80% timeout)
		error_code: "CLIENT_TIMEOUT",
		circuit_breaker_threshold: 5,
		recovery_strategy: "immediate_retry",
	},
	server_timeout: {
		name: "Server Processing Timeout",
		description: "Simulates server-side processing timeout (server too slow)",
		timeout_ms: 10000,
		success_rate: 0.3, // 30% success rate (70% timeout)
		error_code: "SERVER_TIMEOUT",
		circuit_breaker_threshold: 3,
		recovery_strategy: "exponential_backoff",
	},
	network_timeout: {
		name: "Network Communication Timeout",
		description: "Simulates network timeout during data transmission",
		timeout_ms: 3000,
		success_rate: 0.15, // 15% success rate (85% timeout)
		error_code: "NETWORK_TIMEOUT",
		circuit_breaker_threshold: 7,
		recovery_strategy: "circuit_breaker_with_fallback",
	},
	gateway_timeout: {
		name: "Gateway/Proxy Timeout",
		description: "Simulates API gateway or proxy timeout",
		timeout_ms: 15000,
		success_rate: 0.1, // 10% success rate (90% timeout)
		error_code: "GATEWAY_TIMEOUT",
		circuit_breaker_threshold: 2,
		recovery_strategy: "circuit_breaker",
	},
	read_timeout: {
		name: "Socket Read Timeout",
		description: "Simulates socket read timeout during data reception",
		timeout_ms: 2000,
		success_rate: 0.25, // 25% success rate (75% timeout)
		error_code: "READ_TIMEOUT",
		circuit_breaker_threshold: 4,
		recovery_strategy: "retry_with_jitter",
	},
	connect_timeout: {
		name: "Connection Establishment Timeout",
		description: "Simulates timeout during connection establishment",
		timeout_ms: 1000,
		success_rate: 0.05, // 5% success rate (95% timeout)
		error_code: "CONNECT_TIMEOUT",
		circuit_breaker_threshold: 10,
		recovery_strategy: "exponential_backoff_with_limit",
	},
} as const;

type ErrorScenarioType = keyof typeof ERROR_SCENARIOS;
type TimeoutType = keyof typeof TIMEOUT_SCENARIOS;
type ServiceContext =
	| "external_api"
	| "database"
	| "cache"
	| "messaging"
	| "file_system";

// =============================================================================
// CIRCUIT BREAKER STATE MANAGEMENT
// =============================================================================

interface CircuitBreakerState {
	isOpen: boolean;
	failureCount: number;
	lastFailureTime: number;
	halfOpenAttempts: number;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreakerKey(
	timeoutType: TimeoutType,
	serviceContext: ServiceContext,
): string {
	return `${timeoutType}_${serviceContext}`;
}

function shouldCircuitBreakerOpen(
	timeoutType: TimeoutType,
	serviceContext: ServiceContext,
): boolean {
	const key = getCircuitBreakerKey(timeoutType, serviceContext);
	const state = circuitBreakers.get(key) || {
		isOpen: false,
		failureCount: 0,
		lastFailureTime: 0,
		halfOpenAttempts: 0,
	};

	const scenario = TIMEOUT_SCENARIOS[timeoutType];
	const now = Date.now();

	// Check if circuit should be half-open (recovery attempt)
	if (state.isOpen && now - state.lastFailureTime > 30000) {
		// 30 seconds
		state.isOpen = false;
		state.halfOpenAttempts = 0;
		circuitBreakers.set(key, state);

		circuitBreakerStateGauge.add(1, {
			// Half-open = 2
			timeout_type: timeoutType,
			service_context: serviceContext,
			state: "half_open",
		});

		return false; // Allow one attempt
	}

	return state.isOpen;
}

function recordCircuitBreakerFailure(
	timeoutType: TimeoutType,
	serviceContext: ServiceContext,
): void {
	const key = getCircuitBreakerKey(timeoutType, serviceContext);
	const state = circuitBreakers.get(key) || {
		isOpen: false,
		failureCount: 0,
		lastFailureTime: 0,
		halfOpenAttempts: 0,
	};

	const scenario = TIMEOUT_SCENARIOS[timeoutType];
	state.failureCount++;
	state.lastFailureTime = Date.now();

	if (state.failureCount >= scenario.circuit_breaker_threshold) {
		state.isOpen = true;
		circuitBreakerStateGauge.add(1, {
			timeout_type: timeoutType,
			service_context: serviceContext,
			state: "open",
		});
	}

	circuitBreakers.set(key, state);
}

function recordCircuitBreakerSuccess(
	timeoutType: TimeoutType,
	serviceContext: ServiceContext,
): void {
	const key = getCircuitBreakerKey(timeoutType, serviceContext);
	const state = circuitBreakers.get(key);

	if (state) {
		state.failureCount = 0;
		state.isOpen = false;
		circuitBreakers.set(key, state);

		circuitBreakerStateGauge.add(1, {
			timeout_type: timeoutType,
			service_context: serviceContext,
			state: "closed",
		});
	}
}

function getCircuitBreakerState(
	timeoutType: TimeoutType,
	serviceContext: ServiceContext,
): string {
	const key = getCircuitBreakerKey(timeoutType, serviceContext);
	const state = circuitBreakers.get(key);

	if (!state) return "closed";
	if (state.isOpen) return "open";
	if (state.halfOpenAttempts > 0) return "half_open";
	return "closed";
}

// =============================================================================
// REQUEST/RESPONSE SCHEMAS - DATABASE ERRORS
// =============================================================================

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

// =============================================================================
// REQUEST/RESPONSE SCHEMAS - TIMEOUT SCENARIOS
// =============================================================================

const TimeoutRequestSchema = z.object({
	timeout_type: z.enum([
		"client_timeout",
		"server_timeout",
		"network_timeout",
		"gateway_timeout",
		"read_timeout",
		"connect_timeout",
	]),
	force_timeout: z.boolean().optional().default(false),
	custom_timeout_ms: z.number().int().min(100).max(30000).optional(),
	service_context: z
		.enum(["external_api", "database", "cache", "messaging", "file_system"])
		.optional()
		.default("external_api"),
	enable_circuit_breaker: z.boolean().optional().default(true),
});

const TimeoutSuccessResponseSchema = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: z.object({
		request_id: z.string(),
		timeout_type: z.string(),
		scenario_name: z.string(),
		execution_time_ms: z.number(),
		service_context: z.string(),
		recovery_strategy: z.string(),
		circuit_breaker_state: z.string(),
		metadata: z.object({
			timeout_threshold_ms: z.number(),
			actual_processing_time_ms: z.number(),
			success_probability: z.number(),
			circuit_breaker_enabled: z.boolean(),
		}),
	}),
});

const TimeoutErrorResponseSchema = GENERIC_ERROR_RESPONSE_SCHEMA.extend({
	error_details: z.object({
		request_id: z.string(),
		timeout_type: z.string(),
		error_code: z.string(),
		timeout_threshold_ms: z.number(),
		actual_execution_time_ms: z.number(),
		service_context: z.string(),
		circuit_breaker_state: z.string(),
		recovery_suggestion: z.string(),
	}),
});

const TimeoutScenariosListResponseSchema =
	GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
		data: z.object({
			scenarios: z.array(
				z.object({
					timeout_type: z.string(),
					name: z.string(),
					description: z.string(),
					timeout_ms: z.number(),
					success_rate: z.number(),
					error_code: z.string(),
					circuit_breaker_threshold: z.number(),
					recovery_strategy: z.string(),
				}),
			),
			total_scenarios: z.number(),
			circuit_breaker_states: z.record(z.string()),
		}),
	});

// Type definitions
type DatabaseErrorRequest = z.infer<typeof DATABASE_ERROR_REQUEST_SCHEMA>;
type DatabaseErrorResponse = z.infer<typeof DATABASE_ERROR_RESPONSE_SCHEMA>;
type ScenariosListResponse = z.infer<typeof SCENARIOS_LIST_RESPONSE_SCHEMA>;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function generateRequestId(): string {
	return randomBytes(16).toString("hex");
}

async function simulateProcessingTime(
	timeoutMs: number,
	forceTimeout: boolean,
	successRate: number,
): Promise<{ timedOut: boolean; processingTime: number }> {
	const shouldTimeout = forceTimeout || Math.random() > successRate;

	if (shouldTimeout) {
		// Simulate timeout - processing takes longer than threshold
		const processingTime = timeoutMs + Math.random() * timeoutMs; // 100%-200% of threshold
		await new Promise((resolve) => setTimeout(resolve, processingTime));
		return { timedOut: true, processingTime };
	}
	// Simulate success - processing completes within threshold
	const processingTime = Math.random() * (timeoutMs * 0.8); // 0%-80% of threshold
	await new Promise((resolve) => setTimeout(resolve, processingTime));
	return { timedOut: false, processingTime };
}

// Helper function to simulate database operations
async function simulateDatabaseOperation(
	errorType: ErrorScenarioType,
	forceError: boolean,
	retryAttempts: number,
	context: string,
	logger: FastifyBaseLogger,
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

// =============================================================================
// ROUTE HANDLERS
// =============================================================================

const errorsRoute: FastifyPluginAsync = async (fastify) => {
	// =============================================================================
	// DATABASE ERROR ENDPOINTS
	// =============================================================================

	// Database connection errors endpoint
	fastify.post<{
		Body: DatabaseErrorRequest;
		Reply: DatabaseErrorResponse;
	}>(
		"/database",
		{
			schema: {
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

			const requestId = generateRequestId();
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

	// List available database error scenarios
	fastify.get<{
		Reply: ScenariosListResponse;
	}>(
		"/database/scenarios",
		{
			schema: {
				response: {
					200: SCENARIOS_LIST_SUCCESS_SCHEMA,
				},
			},
		},
		async (request, reply) => {
			const scenarios = Object.entries(ERROR_SCENARIOS).map(
				([key, config]) => ({
					error_type: key,
					name: config.name,
					description: config.description,
					delay_ms: config.delay_ms,
					success_rate: config.success_rate,
					error_code: config.error_code,
				}),
			);

			return reply.code(200).send({
				success: true,
				data: {
					scenarios,
					total_scenarios: scenarios.length,
				},
			});
		},
	);

	// =============================================================================
	// TIMEOUT SCENARIO ENDPOINTS
	// =============================================================================

	// List all available timeout scenarios
	fastify.get<{
		Reply: z.infer<typeof TimeoutScenariosListResponseSchema>;
	}>(
		"/timeout/scenarios",
		{
			schema: {
				response: {
					200: TimeoutScenariosListResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const scenarios = Object.entries(TIMEOUT_SCENARIOS).map(
				([key, config]) => ({
					timeout_type: key,
					name: config.name,
					description: config.description,
					timeout_ms: config.timeout_ms,
					success_rate: config.success_rate,
					error_code: config.error_code,
					circuit_breaker_threshold: config.circuit_breaker_threshold,
					recovery_strategy: config.recovery_strategy,
				}),
			);

			// Get current circuit breaker states
			const circuitBreakerStates: Record<string, string> = {};
			circuitBreakers.forEach((state, key) => {
				circuitBreakerStates[key] = state.isOpen ? "open" : "closed";
			});

			return reply.status(200).send({
				success: true,
				data: {
					scenarios,
					total_scenarios: scenarios.length,
					circuit_breaker_states: circuitBreakerStates,
				},
			});
		},
	);

	// Execute timeout scenario
	fastify.post<{
		Body: z.infer<typeof TimeoutRequestSchema>;
		Reply:
			| z.infer<typeof TimeoutSuccessResponseSchema>
			| z.infer<typeof TimeoutErrorResponseSchema>;
	}>(
		"/timeout",
		{
			schema: {
				body: TimeoutRequestSchema,
				response: {
					200: TimeoutSuccessResponseSchema,
					408: TimeoutErrorResponseSchema,
					503: TimeoutErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const {
				timeout_type,
				force_timeout,
				custom_timeout_ms,
				service_context,
				enable_circuit_breaker,
			} = request.body;

			const requestId = generateRequestId();
			const scenario = TIMEOUT_SCENARIOS[timeout_type];
			const timeoutThreshold = custom_timeout_ms || scenario.timeout_ms;

			const span = tracer.startSpan("TimeoutScenario.timeout_simulation", {
				attributes: {
					"timeout.type": timeout_type,
					"timeout.threshold_ms": timeoutThreshold,
					"timeout.force": force_timeout,
					"service.context": service_context,
					"circuit_breaker.enabled": enable_circuit_breaker,
					"request.id": requestId,
				},
			});

			try {
				span.addEvent("timeout_simulation_started", {
					"scenario.name": scenario.name,
					"scenario.success_rate": scenario.success_rate,
					"timeout.threshold_ms": timeoutThreshold,
				});

				fastify.log.info({
					request_id: requestId,
					timeout_type,
					scenario_name: scenario.name,
					timeout_threshold_ms: timeoutThreshold,
					force_timeout,
					service_context,
					msg: `#### Starting timeout scenario simulation: ${scenario.name}`,
				});

				// Track metrics
				timeoutScenarioRequestsCounter.add(1, {
					timeout_type,
					service_context,
					force_timeout: force_timeout.toString(),
				});

				// Check circuit breaker state
				if (
					enable_circuit_breaker &&
					shouldCircuitBreakerOpen(timeout_type, service_context)
				) {
					span.addEvent("circuit_breaker_open", {
						"circuit_breaker.state": "open",
						"timeout.type": timeout_type,
						"service.context": service_context,
					});

					fastify.log.warn({
						request_id: requestId,
						timeout_type,
						service_context,
						msg: "#### Circuit breaker is open, rejecting request",
					});

					return reply.status(503).send({
						success: false,
						error: "Service temporarily unavailable due to circuit breaker",
						error_details: {
							request_id: requestId,
							timeout_type,
							error_code: "CIRCUIT_BREAKER_OPEN",
							timeout_threshold_ms: timeoutThreshold,
							actual_execution_time_ms: 0,
							service_context,
							circuit_breaker_state: "open",
							recovery_suggestion:
								"Wait for circuit breaker to reset (30 seconds) or try different service context",
						},
					});
				}

				const startTime = Date.now();
				const result = await simulateProcessingTime(
					timeoutThreshold,
					force_timeout,
					scenario.success_rate,
				);
				const executionTime = Date.now() - startTime;

				timeoutDurationHistogram.record(executionTime / 1000, {
					timeout_type,
					service_context,
					result: result.timedOut ? "timeout" : "success",
				});

				if (result.timedOut) {
					// Timeout occurred
					if (enable_circuit_breaker) {
						recordCircuitBreakerFailure(timeout_type, service_context);
					}

					timeoutScenarioErrorsCounter.add(1, {
						timeout_type,
						error_code: scenario.error_code,
						service_context,
					});

					span.addEvent("timeout_occurred", {
						"timeout.threshold_ms": timeoutThreshold,
						"actual.processing_time_ms": result.processingTime,
						"execution.time_ms": executionTime,
					});

					span.setStatus({
						code: 2, // ERROR
						message: `Timeout occurred: ${scenario.name}`,
					});

					fastify.log.error({
						request_id: requestId,
						timeout_type,
						error_code: scenario.error_code,
						timeout_threshold_ms: timeoutThreshold,
						actual_execution_time_ms: executionTime,
						processing_time_ms: result.processingTime,
						service_context,
						msg: `#### Timeout scenario failed: ${scenario.name}`,
					});

					return reply.status(408).send({
						success: false,
						error: `${scenario.name}: Operation timed out`,
						error_details: {
							request_id: requestId,
							timeout_type,
							error_code: scenario.error_code,
							timeout_threshold_ms: timeoutThreshold,
							actual_execution_time_ms: executionTime,
							service_context,
							circuit_breaker_state: getCircuitBreakerState(
								timeout_type,
								service_context,
							),
							recovery_suggestion: `Use ${scenario.recovery_strategy} strategy`,
						},
					});
				}

				// Success case
				if (enable_circuit_breaker) {
					recordCircuitBreakerSuccess(timeout_type, service_context);
				}

				span.addEvent("timeout_scenario_completed", {
					"processing.time_ms": result.processingTime,
					"execution.time_ms": executionTime,
					success: true,
				});

				span.setStatus({
					code: 1, // OK
					message: "Timeout scenario completed successfully",
				});

				fastify.log.info({
					request_id: requestId,
					timeout_type,
					execution_time_ms: executionTime,
					processing_time_ms: result.processingTime,
					service_context,
					msg: "#### Timeout scenario completed successfully",
				});

				return reply.status(200).send({
					success: true,
					data: {
						request_id: requestId,
						timeout_type,
						scenario_name: scenario.name,
						execution_time_ms: executionTime,
						service_context,
						recovery_strategy: scenario.recovery_strategy,
						circuit_breaker_state: getCircuitBreakerState(
							timeout_type,
							service_context,
						),
						metadata: {
							timeout_threshold_ms: timeoutThreshold,
							actual_processing_time_ms: result.processingTime,
							success_probability: scenario.success_rate,
							circuit_breaker_enabled: enable_circuit_breaker,
						},
					},
				});
			} catch (error) {
				// Unexpected error
				span.recordException(error as Error);
				span.setStatus({
					code: 2, // ERROR
					message: "Unexpected error in timeout simulation",
				});

				fastify.log.error({
					request_id: requestId,
					timeout_type,
					error: error,
					msg: "#### Unexpected error in timeout simulation",
				});

				return reply.status(500).send({
					success: false,
					error: "Unexpected error in timeout simulation",
					error_details: {
						request_id: requestId,
						timeout_type,
						error_code: "SIMULATION_ERROR",
						timeout_threshold_ms: timeoutThreshold,
						actual_execution_time_ms: 0,
						service_context,
						circuit_breaker_state: getCircuitBreakerState(
							timeout_type,
							service_context,
						),
						recovery_suggestion: "Check server logs and retry",
					},
				});
			} finally {
				span.end();
			}
		},
	);
};

export default errorsRoute;
