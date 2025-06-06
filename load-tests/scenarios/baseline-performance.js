import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";

// Import our utilities
import {
	currentEnv,
	getThresholds,
	defaultHeaders,
} from "../config/environments.js";
import {
	generateSlowRequest,
	generateReviewData,
	randomThinkTime,
	generateUserSession,
	getScenarioWeights,
	generateDatabaseHeavyRequest,
	generateCpuIntensiveRequest,
} from "../utils/data-generators.js";

// Import database heavy scenario
import {
	executeDatabaseHeavyScenario,
	getDatabaseHeavyThresholds,
} from "./modules/database-heavy-operations.js";

// Import database error scenarios
import {
	executeDatabaseErrorScenario,
	validateDatabaseErrorScenariosEndpoint,
	databaseErrorMetrics,
} from "./modules/database-error-scenarios.js";

// Custom metrics for observability comparison
const customSuccessRate = new Counter("custom_success_requests");
const customErrorRate = new Counter("custom_error_requests");
const endpointResponseTime = new Trend("endpoint_response_time");
const slowEndpointAccuracy = new Trend("slow_endpoint_accuracy");

// Test configuration
export const options = {
	stages: [
		{ duration: "2m", target: 10 }, // Ramp up to 10 users
		{ duration: "5m", target: 25 }, // Stay at 25 users for 5 minutes
		{ duration: "3m", target: 50 }, // Ramp up to 50 users
		{ duration: "5m", target: 50 }, // Stay at 50 users for 5 minutes
		{ duration: "2m", target: 0 }, // Ramp down to 0 users
	],
	thresholds: {
		...getThresholds(),
		...getDatabaseHeavyThresholds(),
		custom_success_requests: ["rate>0.85"], // 85% success rate
		slow_endpoint_accuracy: ["p(95)<50"], // Latency accuracy within 50ms
		// Database error scenarios thresholds
		database_error_success_rate: ["rate>0.15"], // At least 15% success rate (due to high failure rates)
		database_error_recovery_rate: ["rate>0.20"], // At least 20% recovery rate
		database_error_execution_time_ms: ["p(95)<15000"], // 95% under 15 seconds
		database_error_retry_attempts: ["avg<3"], // Average retry attempts under 3
	},
};

// Setup function - runs once per VU at the beginning
export function setup() {
	// Validate database error scenarios endpoint is available
	const testSession = generateUserSession();
	const isValid = validateDatabaseErrorScenariosEndpoint(testSession);

	console.log(
		`🔧 Setup: Database error scenarios endpoint validation: ${isValid ? "✅ PASSED" : "❌ FAILED"}`,
	);

	return {
		databaseErrorScenariosAvailable: isValid,
		setupTime: new Date().toISOString(),
	};
}

// Main test function
export default function (data) {
	const session = generateUserSession();
	const weights = getScenarioWeights();
	const scenario = selectScenario(weights);

	console.log(`🧪 User ${session.userId} executing: ${scenario}`);

	// Skip database errors if not available
	if (
		scenario === "database_errors" &&
		!data?.databaseErrorScenariosAvailable
	) {
		console.log(
			`⚠️  User ${session.userId}: Database errors scenario skipped - endpoint not available`,
		);
		sleep(randomThinkTime());
		return;
	}

	switch (scenario) {
		case "read_heavy":
			executeReadScenario(session);
			break;
		case "write_operations":
			executeWriteScenario(session);
			break;
		case "performance_test":
			executePerformanceScenario(session);
			break;
		case "error_simulation":
			executeErrorScenario(session);
			break;
		case "database_heavy":
			executeDatabaseHeavyScenario(session, {
				successRate: customSuccessRate,
				errorRate: customErrorRate,
				endpointResponseTime: endpointResponseTime,
			});
			break;
		case "cpu_intensive":
			executeCpuIntensiveScenario(session);
			break;
		case "database_errors":
			executeDatabaseErrorScenario(session, customSuccessRate);
			break;
	}

	// Human-like think time between scenarios
	sleep(randomThinkTime());
}

/**
 * Select scenario based on weights
 */
function selectScenario(weights) {
	const random = Math.random();
	let cumulative = 0;

	for (const [scenario, weight] of Object.entries(weights)) {
		cumulative += weight;
		if (random <= cumulative) {
			return scenario;
		}
	}
	return "read_heavy"; // fallback
}

/**
 * Execute read-heavy scenario (fetch books)
 */
function executeReadScenario(session) {
	const startTime = Date.now();

	// Health check
	let response = http.get(`${currentEnv.baseUrl}/health`, {
		headers: defaultHeaders,
	});

	const healthCheck = check(response, {
		"health check status is 200": (r) => r.status === 200,
		"health check response time < 100ms": (r) => r.timings.duration < 100,
	});

	if (healthCheck) {
		customSuccessRate.add(1);
	} else {
		customErrorRate.add(1);
	}

	sleep(0.5);

	// Fetch books (main read operation)
	response = http.get(`${currentEnv.baseUrl}/v1/books`, {
		headers: {
			...defaultHeaders,
			"X-User-Session": session.sessionId,
			"X-User-ID": session.userId.toString(),
		},
	});

	const booksCheck = check(response, {
		"books fetch status is 200": (r) => r.status === 200,
		"books response has data": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.success === true && Array.isArray(body.data);
			} catch (e) {
				return false;
			}
		},
		"books response time < 1000ms": (r) => r.timings.duration < 1000,
	});

	if (booksCheck) {
		customSuccessRate.add(1);
	} else {
		customErrorRate.add(1);
	}

	const totalTime = Date.now() - startTime;
	endpointResponseTime.add(totalTime);
}

/**
 * Execute write operations scenario (create reviews)
 */
function executeWriteScenario(session) {
	const startTime = Date.now();
	const reviewData = generateReviewData();

	const response = http.post(
		`${currentEnv.baseUrl}/v1/reviews`,
		JSON.stringify(reviewData),
		{
			headers: {
				...defaultHeaders,
				"X-User-Session": session.sessionId,
				"X-User-ID": session.userId.toString(),
			},
		},
	);

	const reviewCheck = check(response, {
		"review creation status is 200": (r) => r.status === 200,
		"review response is valid": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.success === true && body.data;
			} catch (e) {
				return false;
			}
		},
		"review response time < 2000ms": (r) => r.timings.duration < 2000,
	});

	if (reviewCheck) {
		customSuccessRate.add(1);
	} else {
		customErrorRate.add(1);
	}

	const totalTime = Date.now() - startTime;
	endpointResponseTime.add(totalTime);
}

/**
 * Execute performance testing scenario (slow endpoint)
 */
function executePerformanceScenario(session) {
	const startTime = Date.now();
	const slowRequest = generateSlowRequest();

	console.log(
		`⚡ Testing slow endpoint: ${slowRequest.latency_ms}ms ${slowRequest.operation_type}`,
	);

	const response = http.post(
		`${currentEnv.baseUrl}/v1/performance/slow`,
		JSON.stringify(slowRequest),
		{
			headers: {
				...defaultHeaders,
				"X-User-Session": session.sessionId,
				"X-Performance-Test": "true",
			},
		},
	);

	const slowCheck = check(response, {
		"slow endpoint status is 200": (r) => r.status === 200,
		"slow endpoint response is valid": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.success === true && body.data;
			} catch (e) {
				return false;
			}
		},
		"slow endpoint latency accuracy": (r) => {
			if (r.status !== 200) return false;
			try {
				const body = JSON.parse(r.body);
				const requested = body.data.requested_latency_ms;
				const actual = body.data.actual_duration_ms;
				const accuracy = Math.abs(actual - requested);
				slowEndpointAccuracy.add(accuracy);
				return accuracy < 100; // Within 100ms accuracy
			} catch (e) {
				return false;
			}
		},
	});

	if (slowCheck) {
		customSuccessRate.add(1);
	} else {
		customErrorRate.add(1);
	}

	const totalTime = Date.now() - startTime;
	endpointResponseTime.add(totalTime);
}

/**
 * Execute error simulation scenario
 */
function executeErrorScenario(session) {
	const startTime = Date.now();

	console.log("💥 Testing error simulation endpoint");

	const response = http.get(`${currentEnv.baseUrl}/v1/simulateError`, {
		headers: {
			...defaultHeaders,
			"X-User-Session": session.sessionId,
			"X-Error-Test": "true",
		},
	});

	const errorCheck = check(response, {
		"error simulation returns 500": (r) => r.status === 500,
		"error response is JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"error response time < 1000ms": (r) => r.timings.duration < 1000,
	});

	// For error scenarios, we count 500 status as "success"
	if (errorCheck) {
		customSuccessRate.add(1);
	} else {
		customErrorRate.add(1);
	}

	const totalTime = Date.now() - startTime;
	endpointResponseTime.add(totalTime);
}

/**
 * Execute CPU intensive scenario
 */
function executeCpuIntensiveScenario(session) {
	const startTime = Date.now();
	const cpuRequest = generateCpuIntensiveRequest();

	console.log(
		`🧠 CPU Intensive Test: ${cpuRequest.computation_type} | Intensity: ${cpuRequest.intensity} | User: ${session.userId}`,
	);

	if (cpuRequest.iterations) {
		console.log(`   → Custom iterations: ${cpuRequest.iterations}`);
	}

	const response = http.post(
		`${currentEnv.baseUrl}/v1/performance/cpu`,
		JSON.stringify(cpuRequest),
		{
			headers: {
				...defaultHeaders,
				"X-User-Session": session.sessionId,
				"X-CPU-Test": "true",
			},
		},
	);

	const cpuCheck = check(response, {
		"cpu intensive status is 200": (r) => r.status === 200,
		"cpu intensive response is valid": (r) => {
			try {
				const body = JSON.parse(r.body);
				return body.success === true && body.data;
			} catch (e) {
				return false;
			}
		},
		"cpu intensive response time < 10000ms": (r) => r.timings.duration < 10000, // 10 second timeout
		"cpu intensive response has computation data": (r) => {
			try {
				const body = JSON.parse(r.body);
				return (
					body.data.computation_type &&
					body.data.execution_time_ms &&
					body.data.metadata &&
					body.data.metadata.iterations_completed
				);
			} catch (e) {
				return false;
			}
		},
	});

	if (cpuCheck) {
		customSuccessRate.add(1);
		// Log successful completion with performance data
		try {
			const body = JSON.parse(response.body);
			console.log(
				`   ✅ Success: ${cpuRequest.computation_type} completed in ${body.data.execution_time_ms.toFixed(2)}ms`,
			);
		} catch (e) {
			// Silent fail for logging
		}
	} else {
		customErrorRate.add(1);
	}

	const totalTime = Date.now() - startTime;
	endpointResponseTime.add(totalTime);
}
