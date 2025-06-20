import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { trace, metrics } from "@opentelemetry/api";
import {
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
} from "../../types";
import type { FastifyBaseLogger } from "fastify";
import { randomBytes } from "node:crypto";

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

// Cascading Failure Metrics
const cascadingFailureRequestsCounter = meter.createCounter(
	"cascading_failure_requests_total",
	{
		description: "Total cascading failure simulation requests",
	},
);

const cascadingFailureStepsHistogram = meter.createHistogram(
	"cascading_failure_steps_count",
	{
		description: "Number of failure steps in cascading failure scenarios",
	},
);

const cascadingFailureRecoveryTime = meter.createHistogram(
	"cascading_failure_recovery_time_seconds",
	{
		description: "Time taken to recover from cascading failures",
		unit: "s",
	},
);

const serviceFailureCounter = meter.createCounter(
	"service_failure_events_total",
	{
		description:
			"Total individual service failure events during cascading scenarios",
	},
);

// HTTP Error Code Metrics
const httpErrorCodeRequestsCounter = meter.createCounter(
	"http_error_code_requests_total",
	{
		description: "Total HTTP error code simulation requests",
	},
);

const httpErrorCodeResponseTimeHistogram = meter.createHistogram(
	"http_error_code_response_time_ms",
	{
		description: "Response time for HTTP error code scenarios",
		unit: "ms",
	},
);

const httpErrorCodeSuccessRate = meter.createCounter(
	"http_error_code_success_rate",
	{
		description: "Success rate for HTTP error code scenarios",
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

// =============================================================================
// HTTP ERROR CODE SCENARIOS
// =============================================================================

const HTTP_ERROR_SCENARIOS: Record<number, HttpErrorScenario> = {
	// 4xx Client Errors
	400: {
		code: 400,
		category: "4xx",
		name: "Bad Request",
		description: "Invalid request format or missing required parameters",
		typical_causes: [
			"Invalid JSON format",
			"Missing required fields",
			"Invalid data types",
			"Malformed request body",
		],
		should_retry: false,
		delay_range: { min: 50, max: 200 },
		additional_headers: {
			"X-Error-Type": "validation_error",
		},
	},
	401: {
		code: 401,
		category: "4xx",
		name: "Unauthorized",
		description: "Authentication credentials missing or invalid",
		typical_causes: [
			"Missing authentication token",
			"Expired JWT token",
			"Invalid API key",
			"Revoked credentials",
		],
		should_retry: false,
		delay_range: { min: 100, max: 300 },
		additional_headers: {
			"WWW-Authenticate": "Bearer",
			"X-Error-Type": "authentication_error",
		},
	},
	403: {
		code: 403,
		category: "4xx",
		name: "Forbidden",
		description: "Access denied due to insufficient permissions",
		typical_causes: [
			"Insufficient user permissions",
			"Resource access denied",
			"IP address blocked",
			"Rate limit exceeded",
		],
		should_retry: false,
		delay_range: { min: 80, max: 250 },
		additional_headers: {
			"X-Error-Type": "authorization_error",
		},
	},
	404: {
		code: 404,
		category: "4xx",
		name: "Not Found",
		description: "Requested resource does not exist",
		typical_causes: [
			"Invalid endpoint URL",
			"Deleted resource",
			"Mistyped resource ID",
			"Resource never existed",
		],
		should_retry: false,
		delay_range: { min: 30, max: 150 },
		additional_headers: {
			"X-Error-Type": "resource_not_found",
		},
	},
	409: {
		code: 409,
		category: "4xx",
		name: "Conflict",
		description: "Request conflicts with current resource state",
		typical_causes: [
			"Duplicate resource creation",
			"Concurrent modification",
			"Business rule violation",
			"Version conflict",
		],
		should_retry: true,
		delay_range: { min: 200, max: 500 },
		additional_headers: {
			"X-Error-Type": "conflict_error",
		},
	},
	422: {
		code: 422,
		category: "4xx",
		name: "Unprocessable Entity",
		description: "Request syntax valid but semantically incorrect",
		typical_causes: [
			"Business logic validation failed",
			"Invalid data relationships",
			"Constraint violations",
			"Data integrity issues",
		],
		should_retry: false,
		delay_range: { min: 150, max: 400 },
		additional_headers: {
			"X-Error-Type": "validation_error",
		},
	},
	429: {
		code: 429,
		category: "4xx",
		name: "Too Many Requests",
		description: "Rate limit exceeded",
		typical_causes: [
			"API rate limit exceeded",
			"Too many requests per minute",
			"Burst limit reached",
			"Quota exceeded",
		],
		should_retry: true,
		delay_range: { min: 1000, max: 3000 },
		additional_headers: {
			"Retry-After": "60",
			"X-RateLimit-Remaining": "0",
			"X-Error-Type": "rate_limit_error",
		},
	},

	// 5xx Server Errors
	500: {
		code: 500,
		category: "5xx",
		name: "Internal Server Error",
		description:
			"Generic server error - something went wrong on the server side",
		typical_causes: [
			"Unhandled exceptions",
			"Application bugs",
			"Configuration errors",
			"Resource exhaustion",
		],
		should_retry: true,
		delay_range: { min: 500, max: 2000 },
		additional_headers: {
			"X-Error-Type": "internal_server_error",
		},
	},
	502: {
		code: 502,
		category: "5xx",
		name: "Bad Gateway",
		description: "Invalid response from upstream server",
		typical_causes: [
			"Upstream server down",
			"Invalid response format",
			"Gateway misconfiguration",
			"Network connectivity issues",
		],
		should_retry: true,
		delay_range: { min: 1000, max: 5000 },
		additional_headers: {
			"X-Error-Type": "gateway_error",
		},
	},
	503: {
		code: 503,
		category: "5xx",
		name: "Service Unavailable",
		description: "Service temporarily unavailable",
		typical_causes: [
			"Server overloaded",
			"Maintenance mode",
			"Database unavailable",
			"Dependency service down",
		],
		should_retry: true,
		delay_range: { min: 2000, max: 8000 },
		additional_headers: {
			"Retry-After": "120",
			"X-Error-Type": "service_unavailable",
		},
	},
	504: {
		code: 504,
		category: "5xx",
		name: "Gateway Timeout",
		description: "Upstream server failed to respond in time",
		typical_causes: [
			"Upstream server timeout",
			"Slow database queries",
			"Network latency",
			"Processing bottlenecks",
		],
		should_retry: true,
		delay_range: { min: 5000, max: 15000 },
		additional_headers: {
			"X-Error-Type": "gateway_timeout",
		},
	},
	507: {
		code: 507,
		category: "5xx",
		name: "Insufficient Storage",
		description: "Server unable to store data needed to complete request",
		typical_causes: [
			"Disk space full",
			"Storage quota exceeded",
			"Temporary file creation failed",
			"Database storage limit",
		],
		should_retry: false,
		delay_range: { min: 100, max: 500 },
		additional_headers: {
			"X-Error-Type": "storage_error",
		},
	},
	508: {
		code: 508,
		category: "5xx",
		name: "Loop Detected",
		description: "Infinite loop detected while processing request",
		typical_causes: [
			"Circular dependencies",
			"Recursive calls",
			"Configuration loops",
			"Proxy loop detection",
		],
		should_retry: false,
		delay_range: { min: 200, max: 1000 },
		additional_headers: {
			"X-Error-Type": "loop_detected",
		},
	},
};

// =============================================================================
// CASCADING FAILURE SCENARIOS
// =============================================================================

const CASCADING_FAILURE_SCENARIOS = {
	auth_service_down: {
		name: "Authentication Service Cascade",
		description:
			"Auth service failure causing user service and API gateway failures",
		initial_service: "auth_service",
		cascade_chain: [
			{
				service: "auth_service",
				failure_type: "service_unavailable",
				delay_ms: 500,
				propagation_delay_ms: 1000,
			},
			{
				service: "user_service",
				failure_type: "dependency_timeout",
				delay_ms: 2000,
				propagation_delay_ms: 1500,
			},
			{
				service: "api_gateway",
				failure_type: "cascade_timeout",
				delay_ms: 5000,
				propagation_delay_ms: 2000,
			},
		],
		recovery_strategy: "service_restart_sequence",
		expected_impact: "high",
	},
	database_overload: {
		name: "Database Overload Cascade",
		description:
			"Database overload causing connection pool exhaustion and service degradation",
		initial_service: "database",
		cascade_chain: [
			{
				service: "database",
				failure_type: "performance_degradation",
				delay_ms: 1000,
				propagation_delay_ms: 500,
			},
			{
				service: "connection_pool",
				failure_type: "pool_exhaustion",
				delay_ms: 3000,
				propagation_delay_ms: 1000,
			},
			{
				service: "application_layer",
				failure_type: "response_timeout",
				delay_ms: 8000,
				propagation_delay_ms: 2000,
			},
			{
				service: "load_balancer",
				failure_type: "health_check_failure",
				delay_ms: 12000,
				propagation_delay_ms: 3000,
			},
		],
		recovery_strategy: "database_scaling_and_circuit_breaker",
		expected_impact: "critical",
	},
	external_api_failure: {
		name: "External API Dependency Cascade",
		description:
			"External payment API failure affecting order processing and inventory",
		initial_service: "payment_api",
		cascade_chain: [
			{
				service: "payment_api",
				failure_type: "external_timeout",
				delay_ms: 30000,
				propagation_delay_ms: 500,
			},
			{
				service: "order_service",
				failure_type: "dependency_failure",
				delay_ms: 5000,
				propagation_delay_ms: 2000,
			},
			{
				service: "inventory_service",
				failure_type: "transaction_rollback",
				delay_ms: 2000,
				propagation_delay_ms: 1000,
			},
		],
		recovery_strategy: "fallback_and_retry",
		expected_impact: "medium",
	},
	memory_leak_cascade: {
		name: "Memory Leak Induced Cascade",
		description:
			"Memory leak in one service causing system-wide resource exhaustion",
		initial_service: "analytics_service",
		cascade_chain: [
			{
				service: "analytics_service",
				failure_type: "memory_exhaustion",
				delay_ms: 2000,
				propagation_delay_ms: 1000,
			},
			{
				service: "logging_service",
				failure_type: "resource_contention",
				delay_ms: 4000,
				propagation_delay_ms: 1500,
			},
			{
				service: "monitoring_service",
				failure_type: "metrics_collection_failure",
				delay_ms: 6000,
				propagation_delay_ms: 2000,
			},
			{
				service: "application_cluster",
				failure_type: "oom_killer_activation",
				delay_ms: 10000,
				propagation_delay_ms: 3000,
			},
		],
		recovery_strategy: "service_restart_and_resource_cleanup",
		expected_impact: "critical",
	},
	network_partition: {
		name: "Network Partition Cascade",
		description:
			"Network partition between data centers causing cross-region failures",
		initial_service: "network_infrastructure",
		cascade_chain: [
			{
				service: "network_infrastructure",
				failure_type: "partition_detected",
				delay_ms: 100,
				propagation_delay_ms: 200,
			},
			{
				service: "database_replica",
				failure_type: "replication_lag",
				delay_ms: 5000,
				propagation_delay_ms: 1000,
			},
			{
				service: "cache_cluster",
				failure_type: "cache_invalidation",
				delay_ms: 2000,
				propagation_delay_ms: 800,
			},
			{
				service: "session_store",
				failure_type: "session_loss",
				delay_ms: 1000,
				propagation_delay_ms: 500,
			},
		],
		recovery_strategy: "failover_to_secondary_region",
		expected_impact: "high",
	},
} as const;

type ErrorScenarioType = keyof typeof ERROR_SCENARIOS;
type TimeoutType = keyof typeof TIMEOUT_SCENARIOS;
type CascadingFailureType = keyof typeof CASCADING_FAILURE_SCENARIOS;
type HttpErrorCode = keyof typeof HTTP_ERROR_SCENARIOS;
type ServiceContext =
	| "external_api"
	| "database"
	| "cache"
	| "messaging"
	| "file_system";

interface HttpErrorScenario {
	code: number;
	category: "4xx" | "5xx";
	name: string;
	description: string;
	typical_causes: string[];
	should_retry: boolean;
	delay_range: {
		min: number;
		max: number;
	};
	additional_headers?: Record<string, string>;
}

interface HttpErrorRequestInterface {
	error_code?: number;
	category?: "4xx" | "5xx" | "all";
	include_delay?: boolean;
	custom_message?: string;
	simulate_intermittent?: boolean;
	intermittent_success_rate?: number; // 0-1, default 0.1 (10% success)
}

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

// =============================================================================
// REQUEST/RESPONSE SCHEMAS - CASCADING FAILURE SCENARIOS
// =============================================================================

const CascadingFailureRequestSchema = z.object({
	failure_type: z.enum([
		"auth_service_down",
		"database_overload",
		"external_api_failure",
		"memory_leak_cascade",
		"network_partition",
	]),
	force_cascade: z.boolean().optional().default(false),
	max_cascade_depth: z.number().int().min(1).max(10).optional().default(5),
	cascade_delay_multiplier: z
		.number()
		.min(0.1)
		.max(5.0)
		.optional()
		.default(1.0),
	enable_recovery_simulation: z.boolean().optional().default(true),
	stop_on_first_recovery: z.boolean().optional().default(false),
});

const CascadingFailureSuccessResponseSchema =
	GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
		data: z.object({
			request_id: z.string(),
			failure_type: z.string(),
			scenario_name: z.string(),
			initial_service: z.string(),
			cascade_steps: z.array(
				z.object({
					step_index: z.number(),
					service: z.string(),
					failure_type: z.string(),
					execution_time_ms: z.number(),
					propagation_delay_ms: z.number(),
					status: z.enum(["success", "failed", "recovered"]),
				}),
			),
			total_execution_time_ms: z.number(),
			total_affected_services: z.number(),
			recovery_strategy: z.string(),
			expected_impact: z.string(),
			recovery_time_ms: z.number(),
			metadata: z.object({
				cascade_depth_reached: z.number(),
				services_failed: z.number(),
				services_recovered: z.number(),
				max_cascade_depth: z.number(),
				cascade_delay_multiplier: z.number(),
			}),
		}),
	});

const CascadingFailureErrorResponseSchema =
	GENERIC_ERROR_RESPONSE_SCHEMA.extend({
		error_details: z.object({
			request_id: z.string(),
			failure_type: z.string(),
			initial_service: z.string(),
			cascade_step_failed: z.number(),
			failed_service: z.string(),
			error_code: z.string(),
			total_execution_time_ms: z.number(),
			partial_cascade_steps: z.array(
				z.object({
					step_index: z.number(),
					service: z.string(),
					status: z.enum(["success", "failed", "recovered"]),
				}),
			),
			recovery_suggestion: z.string(),
		}),
	});

const CascadingFailureScenariosListResponseSchema =
	GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
		data: z.object({
			scenarios: z.array(
				z.object({
					failure_type: z.string(),
					name: z.string(),
					description: z.string(),
					initial_service: z.string(),
					cascade_steps: z.number(),
					recovery_strategy: z.string(),
					expected_impact: z.enum(["low", "medium", "high", "critical"]),
				}),
			),
			total_scenarios: z.number(),
		}),
	});

// =============================================================================
// REQUEST/RESPONSE SCHEMAS - HTTP ERROR CODES
// =============================================================================

const HttpErrorRequestSchema = z.object({
	error_code: z
		.number()
		.int()
		.min(400)
		.max(599)
		.optional()
		.refine(
			(code) => !code || HTTP_ERROR_SCENARIOS[code as HttpErrorCode],
			"Unsupported error code",
		),
	category: z.enum(["4xx", "5xx", "all"]).optional().default("all"),
	include_delay: z.boolean().optional().default(true),
	custom_message: z.string().optional(),
	simulate_intermittent: z.boolean().optional().default(false),
	intermittent_success_rate: z.number().min(0).max(1).optional().default(0.1),
});

const HttpErrorSuccessResponseSchema = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: z.object({
		request_id: z.string(),
		error_code: z.number(),
		category: z.string(),
		scenario_name: z.string(),
		description: z.string(),
		execution_time_ms: z.number(),
		should_retry: z.boolean(),
		typical_causes: z.array(z.string()),
		metadata: z.object({
			delay_range_ms: z.object({
				min: z.number(),
				max: z.number(),
			}),
			actual_delay_ms: z.number(),
			intermittent_simulation: z.boolean(),
			success_rate: z.number(),
			additional_headers: z.record(z.string()).optional(),
		}),
	}),
});

const HttpErrorErrorResponseSchema = GENERIC_ERROR_RESPONSE_SCHEMA.extend({
	error_details: z.object({
		request_id: z.string(),
		attempted_error_code: z.number(),
		scenario_name: z.string(),
		execution_time_ms: z.number(),
		retry_recommendation: z.string(),
		typical_causes: z.array(z.string()),
		recovery_suggestion: z.string(),
	}),
});

const HttpErrorScenariosListResponseSchema =
	GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
		data: z.object({
			scenarios: z.array(
				z.object({
					error_code: z.number(),
					category: z.string(),
					name: z.string(),
					description: z.string(),
					should_retry: z.boolean(),
					delay_range: z.object({
						min: z.number(),
						max: z.number(),
					}),
					typical_causes: z.array(z.string()),
					additional_headers: z.record(z.string()).optional(),
				}),
			),
			total_scenarios: z.number(),
			categories: z.object({
				"4xx": z.number(),
				"5xx": z.number(),
			}),
		}),
	});

// Type definitions
type DatabaseErrorRequest = z.infer<typeof DATABASE_ERROR_REQUEST_SCHEMA>;
type DatabaseErrorResponse = z.infer<typeof DATABASE_ERROR_RESPONSE_SCHEMA>;
type ScenariosListResponse = z.infer<typeof SCENARIOS_LIST_RESPONSE_SCHEMA>;
type CascadingFailureRequest = z.infer<typeof CascadingFailureRequestSchema>;
type CascadingFailureResponse =
	| z.infer<typeof CascadingFailureSuccessResponseSchema>
	| z.infer<typeof CascadingFailureErrorResponseSchema>;
type HttpErrorRequest = z.infer<typeof HttpErrorRequestSchema>;
type HttpErrorResponse =
	| z.infer<typeof HttpErrorSuccessResponseSchema>
	| z.infer<typeof HttpErrorErrorResponseSchema>;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

async function simulateHttpError(
	errorCode: HttpErrorCode | undefined,
	category: "4xx" | "5xx" | "all",
	includeDelay: boolean,
	simulateIntermittent: boolean,
	intermittentSuccessRate: number,
	customMessage: string | undefined,
	logger: FastifyBaseLogger,
): Promise<{
	success: boolean;
	errorCode: number;
	scenario: HttpErrorScenario;
	executionTime: number;
	actualDelay: number;
	intermittentSimulation: boolean;
}> {
	const startTime = Date.now();

	// Select error code based on request
	let selectedCode: HttpErrorCode;
	if (errorCode && HTTP_ERROR_SCENARIOS[errorCode]) {
		selectedCode = errorCode;
	} else {
		// Get random error code based on category
		const availableCodes = Object.keys(HTTP_ERROR_SCENARIOS)
			.map(Number)
			.filter((code) => {
				const scenario = HTTP_ERROR_SCENARIOS[code as HttpErrorCode];
				if (!scenario) return false;
				if (category === "all") return true;
				return scenario.category === category;
			}) as HttpErrorCode[];

		if (availableCodes.length === 0) {
			throw new Error(
				`No HTTP error codes available for category: ${category}`,
			);
		}

		const randomIndex = Math.floor(Math.random() * availableCodes.length);
		const tempCode = availableCodes[randomIndex];
		if (tempCode === undefined) {
			throw new Error("Failed to select HTTP error code");
		}
		selectedCode = tempCode;
	}

	const scenario = HTTP_ERROR_SCENARIOS[selectedCode];
	if (!scenario) {
		throw new Error(`Unsupported HTTP error code: ${selectedCode}`);
	}

	const span = tracer.startSpan(`HttpError.${selectedCode}`, {
		attributes: {
			"http.error_code": selectedCode,
			"http.category": scenario.category,
			"http.scenario_name": scenario.name,
			"http.should_retry": scenario.should_retry,
			"operation.include_delay": includeDelay,
			"operation.simulate_intermittent": simulateIntermittent,
			"operation.intermittent_success_rate": intermittentSuccessRate,
		},
	});

	try {
		logger.info({
			error_code: selectedCode,
			scenario_name: scenario.name,
			category: scenario.category,
			should_retry: scenario.should_retry,
			include_delay: includeDelay,
			simulate_intermittent: simulateIntermittent,
			msg: `#### Simulating HTTP ${selectedCode} error: ${scenario.name}`,
		});

		// Handle intermittent simulation
		let success = false;
		if (simulateIntermittent) {
			success = Math.random() < intermittentSuccessRate;
			span.setAttributes({
				"intermittent.enabled": true,
				"intermittent.success": success,
				"intermittent.success_rate": intermittentSuccessRate,
			});
		}

		// Calculate and apply delay
		let actualDelay = 0;
		if (includeDelay && !success) {
			actualDelay =
				scenario.delay_range.min +
				Math.random() * (scenario.delay_range.max - scenario.delay_range.min);

			await new Promise((resolve) => setTimeout(resolve, actualDelay));
		}

		const executionTime = Date.now() - startTime;

		logger.info({
			error_code: selectedCode,
			success: success,
			execution_time_ms: executionTime,
			actual_delay_ms: actualDelay,
			typical_causes: scenario.typical_causes,
			msg: "#### HTTP error simulation completed",
		});

		span.setAttributes({
			"operation.success": success,
			"timing.execution_time_ms": executionTime,
			"timing.actual_delay_ms": actualDelay,
		});

		return {
			success,
			errorCode: selectedCode,
			scenario,
			executionTime,
			actualDelay,
			intermittentSimulation: simulateIntermittent,
		};
	} finally {
		span.end();
	}
}

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

// Helper function to simulate cascading failures
async function simulateCascadingFailure(
	failureType: CascadingFailureType,
	forceCascade: boolean,
	maxCascadeDepth: number,
	cascadeDelayMultiplier: number,
	enableRecoverySimulation: boolean,
	stopOnFirstRecovery: boolean,
	logger: FastifyBaseLogger,
): Promise<{
	success: boolean;
	cascadeSteps: Array<{
		step_index: number;
		service: string;
		failure_type: string;
		execution_time_ms: number;
		propagation_delay_ms: number;
		status: "success" | "failed" | "recovered";
	}>;
	totalExecutionTime: number;
	totalAffectedServices: number;
	recoveryTime: number;
	metadata: {
		cascade_depth_reached: number;
		services_failed: number;
		services_recovered: number;
		max_cascade_depth: number;
		cascade_delay_multiplier: number;
	};
}> {
	const scenario = CASCADING_FAILURE_SCENARIOS[failureType];
	const startTime = Date.now();
	const cascadeSteps: Array<{
		step_index: number;
		service: string;
		failure_type: string;
		execution_time_ms: number;
		propagation_delay_ms: number;
		status: "success" | "failed" | "recovered";
	}> = [];

	let servicesFailedCount = 0;
	let servicesRecoveredCount = 0;
	let cascadeDepthReached = 0;

	const span = tracer.startSpan(`CascadingFailure.${failureType}`, {
		attributes: {
			"failure.type": failureType,
			"failure.scenario": scenario.name,
			"failure.initial_service": scenario.initial_service,
			"operation.force_cascade": forceCascade,
			"operation.max_cascade_depth": maxCascadeDepth,
			"operation.cascade_delay_multiplier": cascadeDelayMultiplier,
		},
	});

	try {
		logger.info({
			failure_type: failureType,
			scenario_name: scenario.name,
			initial_service: scenario.initial_service,
			force_cascade: forceCascade,
			max_cascade_depth: maxCascadeDepth,
			msg: `#### Starting cascading failure simulation: ${scenario.name}`,
		});

		// Process each step in the cascade chain
		for (
			let i = 0;
			i < Math.min(scenario.cascade_chain.length, maxCascadeDepth);
			i++
		) {
			const step = scenario.cascade_chain[i];
			if (!step) {
				throw new Error(`Step ${i} is undefined`);
			}
			const stepStartTime = Date.now();
			cascadeDepthReached = i + 1;

			const stepSpan = tracer.startSpan(`CascadeStep.${step.service}`, {
				attributes: {
					"cascade.step_index": i + 1,
					"cascade.service": step.service,
					"cascade.failure_type": step.failure_type,
					"cascade.delay_ms": step.delay_ms,
					"cascade.propagation_delay_ms": step.propagation_delay_ms,
				},
			});

			try {
				logger.info({
					step_index: i + 1,
					service: step.service,
					failure_type: step.failure_type,
					delay_ms: step.delay_ms * cascadeDelayMultiplier,
					msg: `#### Executing cascade step ${i + 1}: ${step.service}`,
				});

				// Simulate the failure delay (adjusted by multiplier)
				const adjustedDelay = step.delay_ms * cascadeDelayMultiplier;
				await new Promise((resolve) => setTimeout(resolve, adjustedDelay));

				// Determine if this step succeeds, fails, or recovers
				let stepStatus: "success" | "failed" | "recovered" = "failed";

				if (enableRecoverySimulation && i > 0) {
					// Later steps have a chance to recover (20% base chance + 10% per step)
					const recoveryChance = 0.2 + i * 0.1;
					if (!forceCascade && Math.random() < recoveryChance) {
						stepStatus = "recovered";
						servicesRecoveredCount++;

						logger.info({
							step_index: i + 1,
							service: step.service,
							recovery_chance: recoveryChance,
							msg: `#### Service ${step.service} recovered during cascade`,
						});

						if (stopOnFirstRecovery) {
							logger.info({
								step_index: i + 1,
								service: step.service,
								msg: "#### Stopping cascade due to recovery (stop_on_first_recovery=true)",
							});
						}
					}
				}

				if (stepStatus === "failed") {
					servicesFailedCount++;

					// Check if we should continue the cascade
					if (forceCascade || Math.random() < 0.8) {
						// 80% chance to continue cascade
						logger.info({
							step_index: i + 1,
							service: step.service,
							msg: `#### Service ${step.service} failed, cascade continues`,
						});
					} else {
						stepStatus = "success"; // Natural recovery
						logger.info({
							step_index: i + 1,
							service: step.service,
							msg: `#### Service ${step.service} naturally recovered, cascade stopped`,
						});
					}
				}

				const stepExecutionTime = Date.now() - stepStartTime;

				cascadeSteps.push({
					step_index: i + 1,
					service: step.service,
					failure_type: step.failure_type,
					execution_time_ms: stepExecutionTime,
					propagation_delay_ms:
						step.propagation_delay_ms * cascadeDelayMultiplier,
					status: stepStatus,
				});

				stepSpan.setAttributes({
					"cascade.result": stepStatus,
					"cascade.execution_time_ms": stepExecutionTime,
				});

				stepSpan.addEvent("cascade_step_completed", {
					step_index: i + 1,
					service: step.service,
					result: stepStatus,
				});

				stepSpan.end();

				// Simulate propagation delay before next step
				if (
					i < scenario.cascade_chain.length - 1 &&
					(stepStatus === "failed" ||
						(stepStatus === "recovered" && !stopOnFirstRecovery))
				) {
					const propagationDelay =
						step.propagation_delay_ms * cascadeDelayMultiplier;
					await new Promise((resolve) => setTimeout(resolve, propagationDelay));
				}

				// Stop cascade if recovery happened and stopOnFirstRecovery is true
				if (stepStatus === "recovered" && stopOnFirstRecovery) {
					break;
				}

				// Stop cascade if service naturally recovered
				if (stepStatus === "success") {
					break;
				}
			} catch (error) {
				stepSpan.recordException(error as Error);
				stepSpan.setStatus({ code: 2, message: (error as Error).message });
				stepSpan.end();
				throw error;
			}
		}

		const totalExecutionTime = Date.now() - startTime;
		const recoveryTime =
			cascadeSteps.length > 0
				? Math.max(
						...cascadeSteps.map(
							(step) => step.execution_time_ms + step.propagation_delay_ms,
						),
					)
				: 0;

		span.setAttributes({
			"cascade.total_steps": cascadeSteps.length,
			"cascade.services_failed": servicesFailedCount,
			"cascade.services_recovered": servicesRecoveredCount,
			"cascade.total_execution_time_ms": totalExecutionTime,
			"cascade.depth_reached": cascadeDepthReached,
		});

		span.addEvent("cascading_failure_completed", {
			total_steps: cascadeSteps.length,
			services_failed: servicesFailedCount,
			services_recovered: servicesRecoveredCount,
			depth_reached: cascadeDepthReached,
		});

		logger.info({
			failure_type: failureType,
			total_steps: cascadeSteps.length,
			services_failed: servicesFailedCount,
			services_recovered: servicesRecoveredCount,
			total_execution_time_ms: totalExecutionTime,
			cascade_depth_reached: cascadeDepthReached,
			msg: `#### Cascading failure simulation completed: ${scenario.name}`,
		});

		return {
			success: true,
			cascadeSteps,
			totalExecutionTime,
			totalAffectedServices: cascadeSteps.length,
			recoveryTime,
			metadata: {
				cascade_depth_reached: cascadeDepthReached,
				services_failed: servicesFailedCount,
				services_recovered: servicesRecoveredCount,
				max_cascade_depth: maxCascadeDepth,
				cascade_delay_multiplier: cascadeDelayMultiplier,
			},
		};
	} catch (error) {
		span.recordException(error as Error);
		span.setStatus({ code: 2, message: (error as Error).message });
		throw error;
	} finally {
		span.end();
	}
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

	// =============================================================================
	// CASCADING FAILURE SCENARIOS ENDPOINTS
	// =============================================================================

	// GET /cascading/scenarios - List available cascading failure scenarios
	fastify.get<{
		Reply: z.infer<typeof CascadingFailureScenariosListResponseSchema>;
	}>(
		"/cascading/scenarios",
		{
			schema: {
				response: {
					200: CascadingFailureScenariosListResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const scenarios = Object.entries(CASCADING_FAILURE_SCENARIOS).map(
				([key, scenario]) => ({
					failure_type: key,
					name: scenario.name,
					description: scenario.description,
					initial_service: scenario.initial_service,
					cascade_steps: scenario.cascade_chain.length,
					recovery_strategy: scenario.recovery_strategy,
					expected_impact: scenario.expected_impact,
				}),
			);

			return reply.status(200).send({
				success: true,
				data: {
					scenarios,
					total_scenarios: scenarios.length,
				},
			});
		},
	);

	// POST /cascading - Execute cascading failure scenario simulation
	fastify.post<{
		Body: z.infer<typeof CascadingFailureRequestSchema>;
		Reply:
			| z.infer<typeof CascadingFailureSuccessResponseSchema>
			| z.infer<typeof CascadingFailureErrorResponseSchema>;
	}>(
		"/cascading",
		{
			schema: {
				body: CascadingFailureRequestSchema,
				response: {
					200: CascadingFailureSuccessResponseSchema,
					500: CascadingFailureErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const {
				failure_type,
				force_cascade = false,
				max_cascade_depth = 5,
				cascade_delay_multiplier = 1.0,
				enable_recovery_simulation = true,
				stop_on_first_recovery = false,
			} = request.body;

			const requestId = generateRequestId();
			const scenario = CASCADING_FAILURE_SCENARIOS[failure_type];

			// Record metrics
			cascadingFailureRequestsCounter.add(1, {
				failure_type,
				force_cascade: force_cascade.toString(),
				max_cascade_depth: max_cascade_depth.toString(),
			});

			const span = tracer.startSpan("ErrorScenario.cascading_failure", {
				attributes: {
					"http.method": "POST",
					"http.route": "/v1/errors/cascading",
					"endpoint.name": "cascading_failures",
					"test.scenario": "cascading_failure_simulation",
					"failure.type": failure_type,
					"failure.scenario": scenario.name,
					"failure.initial_service": scenario.initial_service,
					"request.id": requestId,
					"operation.force_cascade": force_cascade,
					"operation.max_cascade_depth": max_cascade_depth,
					"operation.cascade_delay_multiplier": cascade_delay_multiplier,
				},
			});

			try {
				fastify.log.info({
					request_id: requestId,
					failure_type,
					scenario_name: scenario.name,
					initial_service: scenario.initial_service,
					force_cascade,
					max_cascade_depth,
					cascade_delay_multiplier,
					enable_recovery_simulation,
					stop_on_first_recovery,
					msg: `#### Starting cascading failure simulation: ${scenario.name}`,
				});

				span.addEvent("cascading_failure_started", {
					failure_type,
					scenario: scenario.name,
					initial_service: scenario.initial_service,
					force_cascade,
					max_cascade_depth,
				});

				const cascadeStartTime = Date.now();

				const result = await simulateCascadingFailure(
					failure_type,
					force_cascade,
					max_cascade_depth,
					cascade_delay_multiplier,
					enable_recovery_simulation,
					stop_on_first_recovery,
					fastify.log,
				);

				const totalCascadeTime = Date.now() - cascadeStartTime;

				// Record metrics
				cascadingFailureStepsHistogram.record(result.cascadeSteps.length, {
					failure_type,
					initial_service: scenario.initial_service,
				});

				cascadingFailureRecoveryTime.record(result.recoveryTime / 1000, {
					failure_type,
					recovery_strategy: scenario.recovery_strategy,
				});

				// Count individual service failures
				result.cascadeSteps.forEach((step) => {
					serviceFailureCounter.add(1, {
						service: step.service,
						failure_type: step.failure_type,
						status: step.status,
					});
				});

				// Success response
				span.setAttributes({
					"cascade.result": "success",
					"cascade.total_steps": result.cascadeSteps.length,
					"cascade.services_failed": result.metadata.services_failed,
					"cascade.services_recovered": result.metadata.services_recovered,
					"cascade.total_execution_time_ms": result.totalExecutionTime,
					"cascade.depth_reached": result.metadata.cascade_depth_reached,
				});

				span.addEvent("cascading_failure_completed", {
					final_result: "success",
					total_steps: result.cascadeSteps.length,
					services_failed: result.metadata.services_failed,
					services_recovered: result.metadata.services_recovered,
					depth_reached: result.metadata.cascade_depth_reached,
				});

				fastify.log.info({
					request_id: requestId,
					failure_type,
					total_steps: result.cascadeSteps.length,
					services_failed: result.metadata.services_failed,
					services_recovered: result.metadata.services_recovered,
					total_execution_time_ms: result.totalExecutionTime,
					depth_reached: result.metadata.cascade_depth_reached,
					msg: "#### Cascading failure simulation completed successfully",
				});

				return reply.code(200).send({
					success: true,
					data: {
						request_id: requestId,
						failure_type,
						scenario_name: scenario.name,
						initial_service: scenario.initial_service,
						cascade_steps: result.cascadeSteps,
						total_execution_time_ms: result.totalExecutionTime,
						total_affected_services: result.totalAffectedServices,
						recovery_strategy: scenario.recovery_strategy,
						expected_impact: scenario.expected_impact,
						recovery_time_ms: result.recoveryTime,
						metadata: result.metadata,
					},
				});
			} catch (error) {
				// Unexpected error
				span.recordException(error as Error);
				span.setStatus({ code: 2, message: (error as Error).message });

				fastify.log.error({
					request_id: requestId,
					failure_type,
					error: error,
					msg: "#### Unexpected error in cascading failure simulation",
				});

				return reply.code(500).send({
					success: false,
					error: `Unexpected error in cascading failure simulation: ${(error as Error).message}`,
					error_details: {
						request_id: requestId,
						failure_type,
						initial_service: scenario.initial_service,
						cascade_step_failed: 0,
						failed_service: "simulation_engine",
						error_code: "SIMULATION_ERROR",
						total_execution_time_ms: 0,
						partial_cascade_steps: [],
						recovery_suggestion:
							"Check server logs and retry with different parameters",
					},
				});
			} finally {
				span.end();
			}
		},
	);

	// =============================================================================
	// HTTP ERROR CODE SCENARIOS ENDPOINTS
	// =============================================================================

	// GET /http-errors/scenarios - List available HTTP error scenarios
	fastify.get<{
		Reply: z.infer<typeof HttpErrorScenariosListResponseSchema>;
	}>(
		"/http-errors/scenarios",
		{
			schema: {
				response: {
					200: HttpErrorScenariosListResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const scenarios = Object.entries(HTTP_ERROR_SCENARIOS).map(
				([key, scenario]) => ({
					error_code: Number(key),
					category: scenario.category,
					name: scenario.name,
					description: scenario.description,
					should_retry: scenario.should_retry,
					delay_range: scenario.delay_range,
					typical_causes: scenario.typical_causes,
					additional_headers: scenario.additional_headers,
				}),
			);

			const fourXXCount = scenarios.filter((s) => s.category === "4xx").length;
			const fiveXXCount = scenarios.filter((s) => s.category === "5xx").length;

			return reply.status(200).send({
				success: true,
				data: {
					scenarios,
					total_scenarios: scenarios.length,
					categories: {
						"4xx": fourXXCount,
						"5xx": fiveXXCount,
					},
				},
			});
		},
	);

	// POST /http-errors - Execute HTTP error scenario simulation
	fastify.post<{
		Body: HttpErrorRequest;
		Reply: HttpErrorResponse;
	}>(
		"/http-errors",
		{
			schema: {
				body: HttpErrorRequestSchema,
				response: {
					200: HttpErrorSuccessResponseSchema,
					400: HttpErrorErrorResponseSchema,
					401: HttpErrorErrorResponseSchema,
					403: HttpErrorErrorResponseSchema,
					404: HttpErrorErrorResponseSchema,
					409: HttpErrorErrorResponseSchema,
					422: HttpErrorErrorResponseSchema,
					429: HttpErrorErrorResponseSchema,
					500: HttpErrorErrorResponseSchema,
					502: HttpErrorErrorResponseSchema,
					503: HttpErrorErrorResponseSchema,
					504: HttpErrorErrorResponseSchema,
					507: HttpErrorErrorResponseSchema,
					508: HttpErrorErrorResponseSchema,
				},
			},
		},
		async (request, reply) => {
			const {
				error_code,
				category = "all",
				include_delay = true,
				custom_message,
				simulate_intermittent = false,
				intermittent_success_rate = 0.1,
			} = request.body;

			const requestId = generateRequestId();

			// Record metrics
			httpErrorCodeRequestsCounter.add(1, {
				error_code: error_code?.toString() || "random",
				category,
				simulate_intermittent: simulate_intermittent.toString(),
			});

			const span = tracer.startSpan("ErrorScenario.http_error", {
				attributes: {
					"http.method": "POST",
					"http.route": "/v1/errors/http-errors",
					"endpoint.name": "http_error_codes",
					"test.scenario": "http_error_simulation",
					"request.id": requestId,
					"operation.error_code": error_code || "random",
					"operation.category": category,
					"operation.include_delay": include_delay,
					"operation.simulate_intermittent": simulate_intermittent,
					"operation.intermittent_success_rate": intermittent_success_rate,
				},
			});

			try {
				fastify.log.info({
					request_id: requestId,
					error_code,
					category,
					include_delay,
					simulate_intermittent,
					intermittent_success_rate,
					custom_message,
					msg: "#### Starting HTTP error code simulation",
				});

				span.addEvent("http_error_simulation_started", {
					error_code: error_code || "random",
					category,
					include_delay,
					simulate_intermittent,
				});

				const simulationStartTime = Date.now();

				const result = await simulateHttpError(
					error_code as HttpErrorCode,
					category,
					include_delay,
					simulate_intermittent,
					intermittent_success_rate,
					custom_message,
					fastify.log,
				);

				const totalSimulationTime = Date.now() - simulationStartTime;

				// Record metrics
				httpErrorCodeResponseTimeHistogram.record(result.executionTime, {
					error_code: result.errorCode.toString(),
					category: result.scenario.category,
					success: result.success.toString(),
				});

				httpErrorCodeSuccessRate.add(result.success ? 1 : 0, {
					error_code: result.errorCode.toString(),
					category: result.scenario.category,
					intermittent: simulate_intermittent.toString(),
				});

				// Handle success case (intermittent simulation succeeded)
				if (result.success && simulate_intermittent) {
					span.setAttributes({
						"simulation.result": "success",
						"simulation.intermittent_success": true,
						"simulation.execution_time_ms": result.executionTime,
					});

					span.addEvent("http_error_simulation_completed", {
						final_result: "success",
						intermittent_success: true,
						error_code: result.errorCode,
					});

					fastify.log.info({
						request_id: requestId,
						error_code: result.errorCode,
						execution_time_ms: result.executionTime,
						msg: "#### HTTP error simulation completed with intermittent success",
					});

					return reply.code(200).send({
						success: true,
						data: {
							request_id: requestId,
							error_code: result.errorCode,
							category: result.scenario.category,
							scenario_name: result.scenario.name,
							description: result.scenario.description,
							execution_time_ms: result.executionTime,
							should_retry: result.scenario.should_retry,
							typical_causes: result.scenario.typical_causes,
							metadata: {
								delay_range_ms: result.scenario.delay_range,
								actual_delay_ms: result.actualDelay,
								intermittent_simulation: result.intermittentSimulation,
								success_rate: intermittent_success_rate,
								additional_headers: result.scenario.additional_headers,
							},
						},
					});
				}

				// Handle error case - return with the actual error code
				span.setAttributes({
					"simulation.result": "error",
					"simulation.error_code": result.errorCode,
					"simulation.execution_time_ms": result.executionTime,
				});

				span.addEvent("http_error_simulation_completed", {
					final_result: "error",
					error_code: result.errorCode,
					scenario: result.scenario.name,
				});

				// Prepare error response
				const errorMessage =
					custom_message ||
					`Simulated ${result.scenario.name}: ${result.scenario.description}`;

				const errorResponse = {
					success: false as const,
					error: errorMessage,
					error_details: {
						request_id: requestId,
						attempted_error_code: result.errorCode,
						scenario_name: result.scenario.name,
						execution_time_ms: result.executionTime,
						retry_recommendation: result.scenario.should_retry
							? "This error can be retried with exponential backoff"
							: "This error should not be retried",
						typical_causes: result.scenario.typical_causes,
						recovery_suggestion: getRecoverySuggestion(result.errorCode),
					},
				};

				// Set response headers if specified
				if (result.scenario.additional_headers) {
					for (const [key, value] of Object.entries(
						result.scenario.additional_headers,
					)) {
						reply.header(key, value);
					}
				}

				fastify.log.info({
					request_id: requestId,
					error_code: result.errorCode,
					scenario_name: result.scenario.name,
					execution_time_ms: result.executionTime,
					should_retry: result.scenario.should_retry,
					msg: `#### HTTP ${result.errorCode} error simulation completed`,
				});

				return reply.code(result.errorCode).send(errorResponse);
			} catch (error) {
				// Unexpected simulation error
				span.recordException(error as Error);
				span.setStatus({ code: 2, message: (error as Error).message });

				fastify.log.error({
					request_id: requestId,
					error: error,
					msg: "#### Unexpected error in HTTP error simulation",
				});

				return reply.code(500).send({
					success: false,
					error: `Unexpected error in HTTP error simulation: ${(error as Error).message}`,
					error_details: {
						request_id: requestId,
						attempted_error_code: error_code || 0,
						scenario_name: "simulation_error",
						execution_time_ms: 0,
						retry_recommendation: "Check server logs and retry",
						typical_causes: [
							"Simulation engine error",
							"Invalid configuration",
						],
						recovery_suggestion:
							"Check server logs for detailed error information",
					},
				});
			} finally {
				span.end();
			}
		},
	);

	// Helper function for recovery suggestions
	function getRecoverySuggestion(errorCode: number): string {
		const scenario = HTTP_ERROR_SCENARIOS[errorCode as HttpErrorCode];
		if (!scenario) return "Check server logs and contact support";

		switch (scenario.category) {
			case "4xx":
				return errorCode === 401
					? "Check authentication credentials and refresh tokens"
					: errorCode === 403
						? "Ensure proper permissions or contact administrator"
						: errorCode === 404
							? "Verify the resource exists and URL is correct"
							: errorCode === 409
								? "Handle conflict resolution and retry"
								: errorCode === 422
									? "Validate request data and fix validation errors"
									: errorCode === 429
										? "Implement exponential backoff and respect rate limits"
										: "Fix request format and validate input data";
			case "5xx":
				return errorCode === 500
					? "Check server logs and retry with exponential backoff"
					: errorCode === 502
						? "Check upstream service availability and configuration"
						: errorCode === 503
							? "Wait for service recovery and implement retry logic"
							: errorCode === 504
								? "Increase timeout values and optimize request"
								: errorCode === 507
									? "Clear disk space or contact administrator"
									: errorCode === 508
										? "Check for circular dependencies in configuration"
										: "Contact support and check system status";
			default:
				return "Check server logs and contact support";
		}
	}
};

export default errorsRoute;
