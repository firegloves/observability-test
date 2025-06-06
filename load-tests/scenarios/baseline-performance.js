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

// Import error scenarios (database errors and timeouts)
import {
	executeDatabaseErrorScenario,
	executeTimeoutScenario,
	executeErrorScenario as executeErrorScenariosModule,
	validateErrorScenariosSetup,
} from "./modules/database-error-scenarios.js";

// Import cascading failure scenarios
import { executeMixedCascadingFailureScenarios } from "./modules/cascading-failure-scenarios.js";

// Import HTTP error scenarios
import {
	executeHttpErrorScenario,
	executeMixedHttpErrorScenario,
	getHttpErrorScenarios,
} from "./modules/http-error-scenarios.js";

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
	},
};

// Setup function - runs once before all tests
export function setup() {
	console.log(`🌍 Test Environment: ${currentEnv.name}`);
	console.log(`🎯 Target URL: ${currentEnv.baseUrl}`);

	// Validate HTTP error scenarios are available
	console.log("🔍 Validating HTTP error scenarios setup...");
	try {
		const httpErrorScenariosResponse = getHttpErrorScenarios(
			currentEnv.baseUrl,
		);
		if (
			!httpErrorScenariosResponse ||
			httpErrorScenariosResponse.status !== 200
		) {
			throw new Error("HTTP error scenarios endpoint not responding");
		}
		console.log("✅ HTTP error scenarios validation passed");
	} catch (error) {
		console.error(
			`❌ HTTP error scenarios validation failed: ${error.message}`,
		);
		// Non-blocking - we can continue without HTTP error scenarios
	}

	console.log("🚀 Starting baseline performance tests...");
	return {
		env: currentEnv,
	};
}

// Main test function
export default function () {
	const session = generateUserSession();
	const weights = getScenarioWeights();
	const scenario = selectScenario(weights);

	console.log(`🧪 User ${session.userId} executing: ${scenario}`);

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
		case "cascading_failure":
			executeCascadingFailureScenario(session);
			break;
		case "http_error_codes":
			executeHttpErrorCodeScenario(session);
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
 * Execute cascading failure scenario
 */
function executeCascadingFailureScenario(session) {
	console.log("💥 Testing cascading failure scenarios");

	const startTime = Date.now();

	const response = executeMixedCascadingFailureScenarios();

	const cascadingCheck = check(response, {
		"cascading scenario responded": (r) =>
			r.status === 200 || r.status === 500 || r.status === 408,
		"cascading scenario response time < 50000ms": (r) =>
			r.timings.duration < 50000,
	});

	if (cascadingCheck) {
		customSuccessRate.add(1);
	} else {
		customErrorRate.add(1);
	}

	const totalTime = Date.now() - startTime;
	endpointResponseTime.add(totalTime);
}

/**
 * Execute HTTP error code scenarios
 */
function executeHttpErrorCodeScenario(session) {
	console.log("🚨 Testing HTTP error code scenarios");

	const startTime = Date.now();

	// 70% specific error codes, 30% mixed/random
	const useSpecificScenario = Math.random() < 0.7;

	let result;
	if (useSpecificScenario) {
		result = executeHttpErrorScenario(currentEnv.baseUrl);
	} else {
		result = executeMixedHttpErrorScenario(currentEnv.baseUrl);
	}

	const httpErrorCheck = check(result, {
		"HTTP error scenario responded": () => result.success !== undefined,
		"HTTP error response time < 30000ms": () => result.response_time < 30000,
		"Valid HTTP error code returned": () => {
			const status = result.actual_status || result.error_code;
			return status >= 400 && status < 600;
		},
	});

	if (httpErrorCheck) {
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
 * Execute comprehensive error simulation scenario (database errors + timeouts)
 */
function executeErrorScenario(session) {
	const startTime = Date.now();

	console.log("💥 Testing comprehensive error scenarios");

	// Execute error scenarios from the dedicated module
	// This includes both database errors and timeout scenarios
	const response = executeErrorScenariosModule(currentEnv.baseUrl);

	// Basic check for any response
	const errorCheck = check(response, {
		"error scenario responded": (r) => r.status !== undefined,
		"error scenario response time < 35000ms": (r) => r.timings.duration < 35000, // Generous timeout for complex scenarios
	});

	// Count responses based on error scenario expectations
	if (
		response.status === 200 ||
		response.status === 408 ||
		response.status === 500 ||
		response.status === 503
	) {
		// These are all valid responses for error scenarios
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
