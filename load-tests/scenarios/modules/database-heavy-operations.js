// =============================================================================
// DATABASE HEAVY SCENARIOS - k6 Load Testing
// =============================================================================
// This file contains scenarios specifically for testing database-heavy operations
// including complex queries, aggregations, and performance monitoring.

import http from "k6/http";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import { currentEnv, defaultHeaders } from "../../config/environments.js";
import { generateDatabaseHeavyRequest } from "../../utils/data-generators.js";

// =============================================================================
// METRICS - Database Heavy Operations
// =============================================================================

export const databaseHeavyMetrics = {
	operations: new Counter("database_heavy_operations_total"),
	responseTime: new Trend("database_heavy_response_time_ms"),
	successRate: new Counter("database_heavy_success_total"),
	errorRate: new Counter("database_heavy_error_total"),
};

// =============================================================================
// SCENARIO EXECUTION - Database Heavy Operations
// =============================================================================

/**
 * Execute database-heavy scenario with comprehensive monitoring
 * @param {Object} session - User session data
 * @param {Object} customMetrics - Additional metrics to track
 */
export function executeDatabaseHeavyScenario(session, customMetrics = null) {
	const startTime = Date.now();
	const databaseRequest = generateDatabaseHeavyRequest();
	const operationType = databaseRequest.operation_type;

	// Log the operation being performed
	console.log(
		`💾 Database Heavy Test: ${operationType} | User: ${session.userId}`,
	);

	// Add operation-specific logging
	if (operationType === "complex_join" && databaseRequest.limit) {
		console.log(`   → Complex JOIN with limit: ${databaseRequest.limit}`);
	} else if (
		operationType === "aggregation" &&
		databaseRequest.aggregation_type
	) {
		console.log(`   → Aggregation type: ${databaseRequest.aggregation_type}`);
	} else if (operationType === "slow_query" && databaseRequest.delay_seconds) {
		console.log(`   → Slow query delay: ${databaseRequest.delay_seconds}s`);
	}

	// Execute the HTTP request
	const response = http.post(
		`${currentEnv.baseUrl}/v1/performance/heavy`,
		JSON.stringify(databaseRequest),
		{
			headers: {
				...defaultHeaders,
				"X-User-Session": session.sessionId,
				"X-User-ID": session.userId.toString(),
				"X-Database-Test": "true",
				"X-Operation-Type": operationType,
			},
		},
	);

	// =============================================================================
	// RESPONSE VALIDATION
	// =============================================================================

	const validationChecks = {
		"database-heavy: status is 200": (r) => r.status === 200,
		"database-heavy: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"database-heavy: response has success field": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.success === true;
			} catch (e) {
				return false;
			}
		},
		"database-heavy: response has data": (r) => {
			try {
				const body = JSON.parse(r.body);
				return (
					body.success === true && body.data !== null && body.data !== undefined
				);
			} catch (e) {
				return false;
			}
		},
	};

	// Add operation-specific response time expectations
	const maxResponseTime = getExpectedResponseTime(operationType);
	validationChecks[`database-heavy: response time < ${maxResponseTime}ms`] = (
		r,
	) => r.timings.duration < maxResponseTime;

	// Execute all validation checks
	const checksResult = check(response, validationChecks);

	// =============================================================================
	// METRICS TRACKING
	// =============================================================================

	// Track operation-specific metrics
	databaseHeavyMetrics.operations.add(1, {
		operation_type: operationType,
		user_id: session.userId.toString(),
	});

	databaseHeavyMetrics.responseTime.add(response.timings.duration, {
		operation_type: operationType,
		success: checksResult ? "true" : "false",
	});

	// Track success/error rates
	if (checksResult) {
		databaseHeavyMetrics.successRate.add(1, { operation_type: operationType });

		// Track additional success metrics if provided
		customMetrics?.successRate?.add(1);
	} else {
		databaseHeavyMetrics.errorRate.add(1, { operation_type: operationType });

		// Track additional error metrics if provided
		customMetrics?.errorRate?.add(1);
	}

	// Track total endpoint response time if provided
	if (customMetrics?.endpointResponseTime) {
		const totalTime = Date.now() - startTime;
		customMetrics.endpointResponseTime.add(totalTime);
	}

	// =============================================================================
	// RESPONSE LOGGING
	// =============================================================================

	if (checksResult) {
		try {
			const responseData = JSON.parse(response.body);
			if (responseData.data?.execution_time_ms) {
				console.log(
					`   ✅ Success: ${operationType} completed in ${responseData.data.execution_time_ms.toFixed(2)}ms`,
				);
			}
		} catch (e) {
			console.log(`   ✅ Success: ${operationType} completed`);
		}
	} else {
		console.log(`   ❌ Failed: ${operationType} - Status: ${response.status}`);
	}

	return checksResult;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get expected response time based on operation type
 * @param {string} operationType - The database operation type
 * @returns {number} Expected max response time in milliseconds
 */
function getExpectedResponseTime(operationType) {
	const expectations = {
		stats: 1000, // 1 second for stats
		complex_join: 2000, // 2 seconds for complex joins
		aggregation: 1500, // 1.5 seconds for aggregations
		slow_query: 5000, // 5 seconds for slow queries (up to 3s delay + processing)
	};

	return expectations[operationType] || 3000; // 3 seconds default
}

/**
 * Get database heavy operation thresholds for k6 configuration
 * @returns {Object} Thresholds object for k6 options
 */
export function getDatabaseHeavyThresholds() {
	return {
		database_heavy_response_time_ms: ["p(95)<3000"], // 95th percentile under 3 seconds
		database_heavy_operations_total: ["count>0"], // At least some operations executed
		database_heavy_success_total: ["rate>0.90"], // 90% success rate for heavy operations
	};
}
