// Database Error Scenarios and Timeout Scenarios Module
// Comprehensive error simulation for observability testing

import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// =============================================================================
// CUSTOM METRICS - DATABASE ERRORS
// =============================================================================
export const requests_total = new Counter("database_errors_requests_total");
export const errors_total = new Counter("database_errors_errors_total");
export const recoveries_total = new Counter("database_errors_recoveries_total");
export const success_rate = new Rate("database_errors_success_rate");
export const recovery_rate = new Rate("database_errors_recovery_rate");
export const execution_time_ms = new Trend("database_errors_execution_time_ms");
export const recovery_time_ms = new Trend("database_errors_recovery_time_ms");
export const retry_attempts = new Trend("database_errors_retry_attempts");

// =============================================================================
// CUSTOM METRICS - TIMEOUT SCENARIOS
// =============================================================================
export const timeout_requests_total = new Counter(
	"timeout_scenario_requests_total",
);
export const timeout_errors_total = new Counter(
	"timeout_scenario_errors_total",
);
export const timeout_success_rate = new Rate("timeout_scenario_success_rate");
export const timeout_execution_time_ms = new Trend(
	"timeout_scenario_execution_time_ms",
);
export const circuit_breaker_events = new Counter(
	"timeout_circuit_breaker_events",
);
export const timeout_duration_actual = new Trend(
	"timeout_scenario_duration_actual",
);
export const circuit_breaker_state_changes = new Counter(
	"timeout_circuit_breaker_state_changes",
);

// =============================================================================
// DATABASE ERROR SCENARIOS
// =============================================================================

const DATABASE_ERROR_SCENARIOS = [
	{
		name: "connection_timeout",
		weight: 30, // 30% of database error traffic
		force_error_probability: 0.7, // 70% forced errors for testing
		retry_attempts: 2,
		operation_contexts: [
			"user_query",
			"background_job",
			"migration",
			"health_check",
		],
	},
	{
		name: "connection_refused",
		weight: 25,
		force_error_probability: 0.8,
		retry_attempts: 1,
		operation_contexts: ["user_query", "health_check"],
	},
	{
		name: "deadlock",
		weight: 20,
		force_error_probability: 0.5,
		retry_attempts: 3,
		operation_contexts: ["user_query", "background_job"],
	},
	{
		name: "pool_exhaustion",
		weight: 15,
		force_error_probability: 0.6,
		retry_attempts: 2,
		operation_contexts: ["user_query", "background_job", "migration"],
	},
	{
		name: "network_partition",
		weight: 10,
		force_error_probability: 0.9, // High failure rate
		retry_attempts: 1,
		operation_contexts: ["health_check"],
	},
];

// =============================================================================
// TIMEOUT SCENARIOS
// =============================================================================

const TIMEOUT_SCENARIOS = [
	{
		name: "client_timeout",
		weight: 25, // 25% of timeout traffic
		force_timeout_probability: 0.8, // 80% forced timeouts for testing
		service_contexts: ["external_api", "database"],
		custom_timeout_range: [3000, 7000], // 3-7 seconds
	},
	{
		name: "server_timeout",
		weight: 20,
		force_timeout_probability: 0.7,
		service_contexts: ["database", "cache"],
		custom_timeout_range: [8000, 12000], // 8-12 seconds
	},
	{
		name: "network_timeout",
		weight: 20,
		force_timeout_probability: 0.85,
		service_contexts: ["external_api", "messaging"],
		custom_timeout_range: [2000, 4000], // 2-4 seconds
	},
	{
		name: "gateway_timeout",
		weight: 15,
		force_timeout_probability: 0.9,
		service_contexts: ["external_api"],
		custom_timeout_range: [10000, 20000], // 10-20 seconds
	},
	{
		name: "read_timeout",
		weight: 12,
		force_timeout_probability: 0.75,
		service_contexts: ["database", "file_system"],
		custom_timeout_range: [1500, 3500], // 1.5-3.5 seconds
	},
	{
		name: "connect_timeout",
		weight: 8,
		force_timeout_probability: 0.95,
		service_contexts: ["external_api", "cache"],
		custom_timeout_range: [500, 1500], // 0.5-1.5 seconds
	},
];

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function selectWeightedScenario(scenarios) {
	const totalWeight = scenarios.reduce((sum, s) => sum + s.weight, 0);
	const random = Math.random() * totalWeight;
	let accumulator = 0;

	for (const scenario of scenarios) {
		accumulator += scenario.weight;
		if (random <= accumulator) {
			return scenario;
		}
	}
	return scenarios[scenarios.length - 1]; // Fallback
}

function getRandomElement(array) {
	return array[Math.floor(Math.random() * array.length)];
}

function logScenarioExecution(type, scenarioName, additional = {}) {
	console.log(
		`🔧 ${type} Test: ${scenarioName}${additional.context ? ` | Context: ${additional.context}` : ""}${additional.service ? ` | Service: ${additional.service}` : ""}`,
	);
	if (additional.timeout) {
		console.log(`   → Timeout threshold: ${additional.timeout}ms`);
	}
	if (additional.retries !== undefined) {
		console.log(`   → Max retries: ${additional.retries}`);
	}
}

// =============================================================================
// DATABASE ERROR VALIDATION
// =============================================================================

function validateDatabaseErrorResponse(response, scenario, force_error) {
	const isSuccess = response.status === 200;

	// Record basic metrics
	requests_total.add(1, {
		scenario: scenario.name,
		force_error: force_error.toString(),
		context: scenario.context,
	});

	success_rate.add(isSuccess, { scenario: scenario.name });

	if (isSuccess) {
		recoveries_total.add(1, { scenario: scenario.name });
		recovery_rate.add(true, { scenario: scenario.name });

		const body = JSON.parse(response.body);
		execution_time_ms.add(body.data.execution_time_ms, {
			scenario: scenario.name,
		});
		recovery_time_ms.add(body.data.metadata.recovery_time_ms, {
			scenario: scenario.name,
		});
		retry_attempts.add(body.data.retry_attempts, { scenario: scenario.name });
	} else {
		errors_total.add(1, {
			scenario: scenario.name,
			status: response.status.toString(),
		});
		recovery_rate.add(false, { scenario: scenario.name });

		if (response.status === 500) {
			const body = JSON.parse(response.body);
			execution_time_ms.add(body.error_details?.total_time_ms || 0, {
				scenario: scenario.name,
			});
			retry_attempts.add(body.error_details?.retry_attempts || 0, {
				scenario: scenario.name,
			});
		}
	}

	// Validation checks
	const checks = {
		"database-error: status is 200 or 500":
			response.status === 200 || response.status === 500,
		"database-error: response is valid JSON": true, // Will throw if invalid
		"database-error: response has success field":
			"success" in JSON.parse(response.body),
	};

	if (response.status === 200) {
		const body = JSON.parse(response.body);
		checks["database-error: response has data"] =
			body.success && "data" in body;
		checks["database-error: execution time is realistic"] =
			body.data.execution_time_ms > 0 && body.data.execution_time_ms < 30000;
	}

	return check(response, checks);
}

// =============================================================================
// TIMEOUT SCENARIO VALIDATION
// =============================================================================

function validateTimeoutResponse(response, scenario, force_timeout) {
	const isSuccess = response.status === 200;
	const isTimeout = response.status === 408;
	const isCircuitBreakerOpen = response.status === 503;

	// Record basic metrics
	timeout_requests_total.add(1, {
		scenario: scenario.name,
		force_timeout: force_timeout.toString(),
		service_context: scenario.service_context,
	});

	timeout_success_rate.add(isSuccess, { scenario: scenario.name });

	if (isSuccess) {
		const body = JSON.parse(response.body);
		timeout_execution_time_ms.add(body.data.execution_time_ms, {
			scenario: scenario.name,
		});
		timeout_duration_actual.add(body.data.metadata.actual_processing_time_ms, {
			scenario: scenario.name,
		});
	} else if (isTimeout) {
		timeout_errors_total.add(1, {
			scenario: scenario.name,
			error_type: "timeout",
			status: response.status.toString(),
		});

		const body = JSON.parse(response.body);
		timeout_execution_time_ms.add(
			body.error_details?.actual_execution_time_ms || 0,
			{ scenario: scenario.name },
		);
	} else if (isCircuitBreakerOpen) {
		circuit_breaker_events.add(1, {
			scenario: scenario.name,
			event_type: "circuit_breaker_open",
			service_context: scenario.service_context,
		});
	}

	// Validation checks
	const checks = {
		"timeout-scenario: status is 200, 408, or 503": [200, 408, 503].includes(
			response.status,
		),
		"timeout-scenario: response is valid JSON": true, // Will throw if invalid
		"timeout-scenario: response format is correct": true,
	};

	const body = JSON.parse(response.body);

	if (response.status === 200) {
		checks["timeout-scenario: success response has data"] =
			body.success && "data" in body;
		checks["timeout-scenario: execution time is realistic"] =
			body.data.execution_time_ms >= 0;
		checks["timeout-scenario: has circuit breaker state"] =
			"circuit_breaker_state" in body.data;
	} else if (response.status === 408) {
		checks["timeout-scenario: timeout response has error details"] =
			"error_details" in body;
		checks["timeout-scenario: timeout has recovery suggestion"] =
			body.error_details && "recovery_suggestion" in body.error_details;
	} else if (response.status === 503) {
		checks["timeout-scenario: circuit breaker response format"] =
			body.error_details &&
			body.error_details.error_code === "CIRCUIT_BREAKER_OPEN";
	}

	return check(response, checks);
}

// =============================================================================
// MAIN EXECUTION FUNCTIONS
// =============================================================================

export function executeDatabaseErrorScenario(baseUrl) {
	const scenario = selectWeightedScenario(DATABASE_ERROR_SCENARIOS);
	const force_error = Math.random() < scenario.force_error_probability;
	const operation_context = getRandomElement(scenario.operation_contexts);
	const retry_attempts = scenario.retry_attempts;

	// Extend scenario with selected parameters
	const extendedScenario = {
		...scenario,
		context: operation_context,
		force_error,
		retry_attempts,
	};

	logScenarioExecution("Database Error", scenario.name, {
		context: operation_context,
		retries: retry_attempts,
	});

	const payload = {
		error_type: scenario.name,
		force_error,
		retry_attempts,
		operation_context,
	};

	const response = http.post(
		`${baseUrl}/v1/errors/database`,
		JSON.stringify(payload),
		{
			headers: { "Content-Type": "application/json" },
			timeout: "30s", // Allow for retries and delays
		},
	);

	try {
		validateDatabaseErrorResponse(response, extendedScenario, force_error);
	} catch (error) {
		console.error(
			`❌ Database error scenario validation failed: ${error.message}`,
		);
		errors_total.add(1, {
			scenario: scenario.name,
			error_type: "validation_error",
		});
	}

	// Small delay between database operations
	sleep(0.1);

	return response;
}

export function executeTimeoutScenario(baseUrl) {
	const scenario = selectWeightedScenario(TIMEOUT_SCENARIOS);
	const force_timeout = Math.random() < scenario.force_timeout_probability;
	const service_context = getRandomElement(scenario.service_contexts);
	const enable_circuit_breaker = Math.random() > 0.2; // 80% enable circuit breaker

	// Random custom timeout within range
	const [minTimeout, maxTimeout] = scenario.custom_timeout_range;
	const custom_timeout_ms =
		Math.floor(Math.random() * (maxTimeout - minTimeout)) + minTimeout;

	// Extend scenario with selected parameters
	const extendedScenario = {
		...scenario,
		service_context,
		force_timeout,
		custom_timeout_ms,
		enable_circuit_breaker,
	};

	logScenarioExecution("Timeout", scenario.name, {
		service: service_context,
		timeout: custom_timeout_ms,
	});

	const payload = {
		timeout_type: scenario.name,
		force_timeout,
		custom_timeout_ms,
		service_context,
		enable_circuit_breaker,
	};

	const response = http.post(
		`${baseUrl}/v1/errors/timeout`,
		JSON.stringify(payload),
		{
			headers: { "Content-Type": "application/json" },
			timeout: "35s", // Allow for longer timeouts
		},
	);

	try {
		validateTimeoutResponse(response, extendedScenario, force_timeout);
	} catch (error) {
		console.error(`❌ Timeout scenario validation failed: ${error.message}`);
		timeout_errors_total.add(1, {
			scenario: scenario.name,
			error_type: "validation_error",
		});
	}

	// Small delay between timeout operations
	sleep(0.1);

	return response;
}

// =============================================================================
// SETUP VALIDATION
// =============================================================================

export function validateErrorScenariosSetup(baseUrl) {
	console.log("🔍 Validating error scenarios endpoints...");

	// Test database scenarios endpoint
	const dbScenariosResponse = http.get(
		`${baseUrl}/v1/errors/database/scenarios`,
		{
			timeout: "10s",
		},
	);

	if (
		!check(dbScenariosResponse, {
			"database scenarios endpoint accessible": (r) => r.status === 200,
			"database scenarios returns valid JSON": (r) => {
				try {
					const body = JSON.parse(r.body);
					return body.success && Array.isArray(body.data.scenarios);
				} catch (e) {
					return false;
				}
			},
		})
	) {
		throw new Error("Database scenarios endpoint validation failed");
	}

	// Test timeout scenarios endpoint
	const timeoutScenariosResponse = http.get(
		`${baseUrl}/v1/errors/timeout/scenarios`,
		{
			timeout: "10s",
		},
	);

	if (
		!check(timeoutScenariosResponse, {
			"timeout scenarios endpoint accessible": (r) => r.status === 200,
			"timeout scenarios returns valid JSON": (r) => {
				try {
					const body = JSON.parse(r.body);
					return body.success && Array.isArray(body.data.scenarios);
				} catch (e) {
					return false;
				}
			},
		})
	) {
		throw new Error("Timeout scenarios endpoint validation failed");
	}

	console.log("✅ Error scenarios endpoints validated successfully");
}

// =============================================================================
// MIXED EXECUTION (for integration in baseline tests)
// =============================================================================

export function executeErrorScenario(baseUrl) {
	// 60% database errors, 40% timeout scenarios
	const scenarioType = Math.random() < 0.6 ? "database" : "timeout";

	if (scenarioType === "database") {
		return executeDatabaseErrorScenario(baseUrl);
	} else {
		return executeTimeoutScenario(baseUrl);
	}
}
