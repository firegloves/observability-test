// Database Error Scenarios Module for k6 Load Testing
// Tests various database connection error scenarios with retry logic and recovery validation

import http from "k6/http";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";

// =============================================================================
// CUSTOM METRICS FOR DATABASE ERROR SCENARIOS
// =============================================================================

export const databaseErrorMetrics = {
	// Counters
	requests: new Counter("database_error_requests_total"),
	errors: new Counter("database_error_errors_total"),
	recoveries: new Counter("database_error_recoveries_total"),

	// Rates
	successRate: new Rate("database_error_success_rate"),
	recoveryRate: new Rate("database_error_recovery_rate"),

	// Trends
	executionTime: new Trend("database_error_execution_time_ms"),
	recoveryTime: new Trend("database_error_recovery_time_ms"),
	retryAttempts: new Trend("database_error_retry_attempts"),
};

// =============================================================================
// ERROR SCENARIO CONFIGURATIONS
// =============================================================================

const ERROR_SCENARIOS = [
	{
		type: "connection_timeout",
		name: "Database Connection Timeout",
		weight: 0.25, // 25% of error tests
		expectedFailureRate: 0.9, // 90% expected failure rate
		maxExpectedTime: 10000, // Max expected time in ms
		retryRange: [1, 3],
		contexts: ["user_query", "background_job"],
	},
	{
		type: "connection_refused",
		name: "Database Connection Refused",
		weight: 0.2, // 20% of error tests
		expectedFailureRate: 0.95, // 95% expected failure rate
		maxExpectedTime: 1000, // Max expected time in ms
		retryRange: [2, 4],
		contexts: ["user_query", "health_check"],
	},
	{
		type: "deadlock",
		name: "Database Deadlock",
		weight: 0.3, // 30% of error tests
		expectedFailureRate: 0.7, // 70% expected failure rate
		maxExpectedTime: 8000, // Max expected time in ms
		retryRange: [1, 5],
		contexts: ["user_query", "background_job"],
	},
	{
		type: "pool_exhaustion",
		name: "Connection Pool Exhaustion",
		weight: 0.15, // 15% of error tests
		expectedFailureRate: 0.8, // 80% expected failure rate
		maxExpectedTime: 12000, // Max expected time in ms
		retryRange: [0, 2],
		contexts: ["background_job", "health_check"],
	},
	{
		type: "network_partition",
		name: "Network Partition",
		weight: 0.1, // 10% of error tests
		expectedFailureRate: 1.0, // 100% expected failure rate
		maxExpectedTime: 20000, // Max expected time in ms
		retryRange: [1, 3],
		contexts: ["migration", "background_job"],
	},
];

// =============================================================================
// WEIGHTED SCENARIO SELECTION
// =============================================================================

function selectErrorScenario() {
	const random = Math.random();
	let cumulativeWeight = 0;

	for (const scenario of ERROR_SCENARIOS) {
		cumulativeWeight += scenario.weight;
		if (random < cumulativeWeight) {
			return scenario;
		}
	}

	// Fallback to deadlock (most common)
	return ERROR_SCENARIOS.find((s) => s.type === "deadlock");
}

function generateErrorScenarioRequest() {
	const scenario = selectErrorScenario();
	const context =
		scenario.contexts[Math.floor(Math.random() * scenario.contexts.length)];
	const retryAttempts =
		Math.floor(
			Math.random() * (scenario.retryRange[1] - scenario.retryRange[0] + 1),
		) + scenario.retryRange[0];

	// 20% chance to force error for deterministic testing
	const forceError = Math.random() < 0.2;

	return {
		error_type: scenario.type,
		force_error: forceError,
		retry_attempts: retryAttempts,
		operation_context: context,
		expectedScenario: scenario,
	};
}

// =============================================================================
// RESPONSE VALIDATION FUNCTIONS
// =============================================================================

function validateErrorResponse(response, request, scenario) {
	const validationChecks = {
		"database-error: status is 200 or 500": (r) =>
			r.status === 200 || r.status === 500,
		"database-error: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"database-error: response has success field": (r) => {
			try {
				const body = JSON.parse(r.body);
				return typeof body.success === "boolean";
			} catch (e) {
				return false;
			}
		},
	};

	// Add time-based validation
	validationChecks[
		`database-error: response time < ${scenario.maxExpectedTime}ms`
	] = (r) => r.timings.duration < scenario.maxExpectedTime;

	try {
		const body = JSON.parse(response.body);

		if (body.success === true) {
			// Success response validation
			validationChecks["database-error: success response has data"] = () =>
				body.data && typeof body.data === "object";
			validationChecks["database-error: success response has error_type"] =
				() => body.data.error_type === request.error_type;
			validationChecks[
				"database-error: success response has recovery strategy"
			] = () =>
				body.data.recovery_strategy &&
				typeof body.data.recovery_strategy === "string";
			validationChecks["database-error: success response has retry attempts"] =
				() =>
					typeof body.data.retry_attempts === "number" &&
					body.data.retry_attempts > 0;
			validationChecks["database-error: success response has metadata"] = () =>
				body.data.metadata && typeof body.data.metadata === "object";
		} else {
			// Error response validation
			validationChecks["database-error: error response has error message"] =
				() => body.error && typeof body.error === "string";
			validationChecks["database-error: error response has error details"] =
				() => body.error_details && typeof body.error_details === "object";
			validationChecks["database-error: error details has retry attempts"] =
				() => typeof body.error_details?.retry_attempts === "number";
		}
	} catch (e) {
		// JSON parsing already failed, validation will catch this
	}

	return check(response, validationChecks);
}

// =============================================================================
// MAIN EXECUTION FUNCTION
// =============================================================================

export function executeDatabaseErrorScenario(session, customMetrics = null) {
	const request = generateErrorScenarioRequest();
	const scenario = request.expectedScenario;

	// Generate request headers
	const headers = {
		"Content-Type": "application/json",
		"X-User-Session": session.sessionId,
		"X-Test-Scenario": "database-error-scenarios",
		"X-Error-Type": request.error_type,
		"X-Operation-Context": request.operation_context,
	};

	// Log the test being executed
	console.log(
		`🔥 Database Error Test: ${scenario.name} | Context: ${request.operation_context} | Retries: ${request.retry_attempts} | Force: ${request.force_error}`,
	);

	const startTime = Date.now();

	// Execute the request
	const response = http.post(
		`${__ENV.BASE_URL || "http://localhost:8081"}/v1/errors/database`,
		JSON.stringify({
			error_type: request.error_type,
			force_error: request.force_error,
			retry_attempts: request.retry_attempts,
			operation_context: request.operation_context,
		}),
		{ headers },
	);

	const executionTime = Date.now() - startTime;

	// =============================================================================
	// RESPONSE VALIDATION
	// =============================================================================

	const isValid = validateErrorResponse(response, request, scenario);
	const wasSuccessful = response.status === 200;
	const wasRecovered = response.status === 200 && !request.force_error;

	// =============================================================================
	// DETAILED RESPONSE ANALYSIS
	// =============================================================================

	let responseData = null;
	let actualRetryAttempts = 0;
	let recoveryTimeMs = 0;

	try {
		responseData = JSON.parse(response.body);

		if (responseData.success) {
			actualRetryAttempts = responseData.data.retry_attempts || 0;
			recoveryTimeMs = responseData.data.metadata?.recovery_time_ms || 0;

			console.log(
				`   ✅ Success: ${scenario.name} recovered in ${actualRetryAttempts} attempts (${executionTime}ms total, ${recoveryTimeMs}ms recovery)`,
			);
		} else {
			actualRetryAttempts = responseData.error_details?.retry_attempts || 0;

			console.log(
				`   ❌ Failed: ${scenario.name} after ${actualRetryAttempts} attempts (${executionTime}ms) - ${responseData.error_details?.error_code}`,
			);
		}
	} catch (e) {
		console.log(
			`   ⚠️  Invalid Response: ${scenario.name} - Could not parse response body`,
		);
	}

	// =============================================================================
	// METRICS TRACKING
	// =============================================================================

	// Track core metrics
	databaseErrorMetrics.requests.add(1, {
		error_type: request.error_type,
		operation_context: request.operation_context,
		force_error: request.force_error.toString(),
	});

	databaseErrorMetrics.successRate.add(wasSuccessful, {
		error_type: request.error_type,
		operation_context: request.operation_context,
	});

	if (wasRecovered) {
		databaseErrorMetrics.recoveries.add(1, {
			error_type: request.error_type,
			operation_context: request.operation_context,
		});
		databaseErrorMetrics.recoveryRate.add(1, {
			error_type: request.error_type,
		});
	} else {
		databaseErrorMetrics.recoveryRate.add(0, {
			error_type: request.error_type,
		});
	}

	if (!wasSuccessful) {
		databaseErrorMetrics.errors.add(1, {
			error_type: request.error_type,
			error_code: responseData?.error_details?.error_code || "UNKNOWN",
			operation_context: request.operation_context,
		});
	}

	// Track timing metrics
	databaseErrorMetrics.executionTime.add(executionTime, {
		error_type: request.error_type,
		success: wasSuccessful.toString(),
	});

	if (recoveryTimeMs > 0) {
		databaseErrorMetrics.recoveryTime.add(recoveryTimeMs, {
			error_type: request.error_type,
		});
	}

	databaseErrorMetrics.retryAttempts.add(actualRetryAttempts, {
		error_type: request.error_type,
		success: wasSuccessful.toString(),
	});

	// Track custom metrics if provided
	if (customMetrics) {
		customMetrics.add(1, {
			scenario: "database_error",
			error_type: request.error_type,
			success: wasSuccessful.toString(),
		});
	}

	// =============================================================================
	// SCENARIO-SPECIFIC VALIDATION
	// =============================================================================

	// Validate behavior matches expected failure rates
	if (request.force_error && wasSuccessful) {
		console.log(
			`   ⚠️  Unexpected: ${scenario.name} succeeded despite force_error=true`,
		);
	}

	if (
		!request.force_error &&
		scenario.expectedFailureRate === 1.0 &&
		wasSuccessful
	) {
		console.log(
			`   ⚠️  Unexpected: ${scenario.name} succeeded despite 100% expected failure rate`,
		);
	}

	// Validate retry attempts are within expected range
	if (actualRetryAttempts > request.retry_attempts + 1) {
		console.log(
			`   ⚠️  Unexpected: ${scenario.name} made ${actualRetryAttempts} attempts, expected max ${request.retry_attempts + 1}`,
		);
	}

	return {
		success: isValid && wasSuccessful,
		response: response,
		executionTime: executionTime,
		recoveryTime: recoveryTimeMs,
		retryAttempts: actualRetryAttempts,
		scenario: scenario.name,
		errorType: request.error_type,
	};
}

// =============================================================================
// SCENARIOS LIST VALIDATION
// =============================================================================

export function validateDatabaseErrorScenariosEndpoint(session) {
	console.log("🔍 Validating database error scenarios list endpoint");

	const response = http.get(
		`${__ENV.BASE_URL || "http://localhost:8081"}/v1/errors/database/scenarios`,
		{
			headers: {
				"X-User-Session": session.sessionId,
				"X-Test-Scenario": "database-error-scenarios-list",
			},
		},
	);

	const isValid = check(response, {
		"scenarios-list: status is 200": (r) => r.status === 200,
		"scenarios-list: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"scenarios-list: has scenarios array": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.success === true && Array.isArray(body.data.scenarios);
			} catch (e) {
				return false;
			}
		},
		"scenarios-list: has 5 scenarios": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.data.scenarios.length === 5;
			} catch (e) {
				return false;
			}
		},
		"scenarios-list: scenarios have required fields": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.data.scenarios.every(
					(scenario) =>
						scenario.error_type &&
						scenario.name &&
						scenario.description &&
						typeof scenario.delay_ms === "number" &&
						typeof scenario.success_rate === "number" &&
						scenario.error_code,
				);
			} catch (e) {
				return false;
			}
		},
	});

	if (isValid) {
		console.log(
			"   ✅ Database error scenarios list endpoint validated successfully",
		);
	} else {
		console.log(
			"   ❌ Database error scenarios list endpoint validation failed",
		);
	}

	return isValid;
}

// =============================================================================
// EXPORT DEFAULT FUNCTIONS
// =============================================================================

export default {
	executeDatabaseErrorScenario,
	validateDatabaseErrorScenariosEndpoint,
	databaseErrorMetrics,
};
