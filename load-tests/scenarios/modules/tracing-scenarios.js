import http from "k6/http";
import { check } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { currentEnv } from "../../config/environments.js";

// Custom metrics for tracing scenarios
export const tracingTestRequestsTotal = new Counter(
	"tracing_test_requests_total",
);
export const tracingAttributeExtractionTime = new Trend(
	"tracing_attribute_extraction_time_ms",
);
export const tracingSpanCreationTime = new Trend(
	"tracing_span_creation_time_ms",
);
export const tracingNestedOperationsTime = new Trend(
	"tracing_nested_operations_time_ms",
);
export const tracingSuccessRate = new Rate("tracing_success_rate");

/**
 * Configuration for tracing test scenarios
 */
const TRACING_TEST_SCENARIOS = {
	user_authentication: {
		name: "User Authentication Test",
		operation_type: "user_authentication",
		test_payload: {
			size: 50,
			complexity: "simple",
			simulate_processing_time: true,
		},
		weight: 0.2,
	},
	data_processing: {
		name: "Data Processing Test",
		operation_type: "data_processing",
		test_payload: {
			size: 200,
			complexity: "medium",
			simulate_processing_time: true,
		},
		weight: 0.3,
	},
	external_api_call: {
		name: "External API Call Test",
		operation_type: "external_api_call",
		test_payload: {
			size: 100,
			complexity: "complex",
			simulate_processing_time: true,
		},
		weight: 0.2,
	},
	database_query: {
		name: "Database Query Test",
		operation_type: "database_query",
		test_payload: {
			size: 500,
			complexity: "medium",
			simulate_processing_time: true,
		},
		weight: 0.2,
	},
	cache_operation: {
		name: "Cache Operation Test",
		operation_type: "cache_operation",
		test_payload: {
			size: 10,
			complexity: "simple",
			simulate_processing_time: false,
		},
		weight: 0.1,
	},
};

/**
 * Select a weighted tracing scenario
 */
function selectTracingScenario() {
	const scenarios = Object.values(TRACING_TEST_SCENARIOS);
	let totalWeight = 0;
	const random = Math.random();

	for (const scenario of scenarios) {
		totalWeight += scenario.weight;
		if (random <= totalWeight) {
			return scenario;
		}
	}

	// Fallback to data_processing
	return TRACING_TEST_SCENARIOS.data_processing;
}

/**
 * Generate realistic custom metadata for testing
 */
function generateCustomMetadata(operationType) {
	const baseMetadata = {
		client_version: `v${Math.floor(Math.random() * 3) + 1}.${Math.floor(Math.random() * 10)}`,
		environment: currentEnv.name || "local",
		test_run_id: `test-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
	};

	const typeSpecificMetadata = {
		user_authentication: {
			auth_method: Math.random() > 0.5 ? "jwt" : "oauth",
			login_attempt: Math.floor(Math.random() * 3) + 1,
		},
		data_processing: {
			batch_id: `batch-${Math.floor(Math.random() * 1000)}`,
			processing_mode: Math.random() > 0.5 ? "sync" : "async",
		},
		external_api_call: {
			api_provider: Math.random() > 0.5 ? "service_a" : "service_b",
			timeout_ms: Math.floor(Math.random() * 5000) + 1000,
		},
		database_query: {
			query_type: Math.random() > 0.5 ? "read" : "write",
			connection_pool: `pool-${Math.floor(Math.random() * 5) + 1}`,
		},
		cache_operation: {
			cache_provider: Math.random() > 0.5 ? "redis" : "memcached",
			ttl_seconds: Math.floor(Math.random() * 3600) + 300,
		},
	};

	return {
		...baseMetadata,
		...(typeSpecificMetadata[operationType] || {}),
	};
}

/**
 * Execute tracing test with custom span attributes
 */
export function executeTracingAttributesTest(baseUrl, session) {
	const scenario = selectTracingScenario();
	const customMetadata = generateCustomMetadata(scenario.operation_type);

	console.log(`🔍 Tracing Test: ${scenario.name} | User: ${session.userId}`);

	const payload = {
		operation_type: scenario.operation_type,
		test_payload: scenario.test_payload,
		custom_metadata: customMetadata,
	};

	const headers = {
		"Content-Type": "application/json",
		"X-User-ID": session.userId.toString(),
		"X-User-Session": session.sessionId,
		"X-Performance-Test": "tracing-attributes",
		"X-Operation-Type": scenario.operation_type,
	};

	const response = http.post(
		`${baseUrl}/v1/tracing/test-attributes`,
		JSON.stringify(payload),
		{ headers },
	);

	// Record metrics
	tracingTestRequestsTotal.add(1, {
		operation_type: scenario.operation_type,
		complexity: scenario.test_payload.complexity,
		has_custom_metadata: true,
	});

	// Basic response validation
	const basicChecks = check(response, {
		"tracing-test: status is 200": (r) => r.status === 200,
		"tracing-test: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"tracing-test: response time < 5000ms": (r) => r.timings.duration < 5000,
	});

	if (basicChecks) {
		try {
			const data = JSON.parse(response.body);

			if (response.status === 200 && data.success) {
				const responseData = data.data;

				// Record timing metrics
				tracingAttributeExtractionTime.add(
					responseData.metadata.processing_duration_ms,
					{
						operation_type: scenario.operation_type,
					},
				);

				tracingSpanCreationTime.add(responseData.execution_time_ms, {
					operation_type: scenario.operation_type,
					complexity: scenario.test_payload.complexity,
				});

				// Success rate
				tracingSuccessRate.add(1);

				console.log(
					`   ✅ Success: ${scenario.operation_type} | Attributes: ${responseData.metadata.attributes_count} | Time: ${responseData.execution_time_ms}ms`,
				);

				// Detailed checks for success response
				const successChecks = check(response, {
					"tracing-test: has extracted attributes": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data.extracted_attributes &&
							Object.keys(data.data.extracted_attributes).length > 0
						);
					},
					"tracing-test: has user context": (r) => {
						const data = JSON.parse(r.body);
						return data.data.user_context && data.data.user_context.user_id;
					},
					"tracing-test: has span context": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data.span_context &&
							data.data.span_context.trace_id &&
							data.data.span_context.span_id
						);
					},
					"tracing-test: operation type matches": (r) => {
						const data = JSON.parse(r.body);
						return data.data.operation_type === scenario.operation_type;
					},
					"tracing-test: attributes count > 5": (r) => {
						const data = JSON.parse(r.body);
						return data.data.metadata.attributes_count >= 5;
					},
					"tracing-test: has custom attributes flag": (r) => {
						const data = JSON.parse(r.body);
						return data.data.span_context.has_custom_attributes === true;
					},
				});

				return {
					success: true,
					scenario: scenario.operation_type,
					response_time: response.timings.duration,
				};
			} else {
				// Handle error response
				tracingSuccessRate.add(0);
				console.log(
					`   ❌ Failed: ${scenario.operation_type} - Status: ${response.status}`,
				);
				return {
					success: false,
					scenario: scenario.operation_type,
					error: data.error || "Unknown error",
				};
			}
		} catch (parseError) {
			tracingSuccessRate.add(0);
			console.log(`   ❌ JSON Parse Error: ${scenario.operation_type}`);
			return {
				success: false,
				scenario: scenario.operation_type,
				error: "JSON parse error",
			};
		}
	} else {
		tracingSuccessRate.add(0);
		console.log(
			`   ❌ Basic Checks Failed: ${scenario.operation_type} - Status: ${response.status}`,
		);
		return {
			success: false,
			scenario: scenario.operation_type,
			error: "Basic checks failed",
		};
	}
}

/**
 * Execute nested operations tracing test
 */
export function executeNestedTracingTest(baseUrl, session) {
	console.log(`🔗 Nested Tracing Test | User: ${session.userId}`);

	const payload = {
		parent_operation: `parent_${session.userId}`,
		child_operations: [
			`child_auth_${session.userId}`,
			`child_data_${session.userId}`,
			`child_cache_${session.userId}`,
		],
		depth: 2,
	};

	const headers = {
		"Content-Type": "application/json",
		"X-User-ID": session.userId.toString(),
		"X-User-Session": session.sessionId,
		"X-Performance-Test": "nested-tracing",
		"X-Operation-Type": "nested_operations",
	};

	const response = http.post(
		`${baseUrl}/v1/tracing/nested-operations`,
		JSON.stringify(payload),
		{ headers },
	);

	// Record metrics
	tracingTestRequestsTotal.add(1, {
		operation_type: "nested_operations",
		child_count: payload.child_operations.length,
	});

	// Basic response validation
	const basicChecks = check(response, {
		"nested-tracing: status is 200": (r) => r.status === 200,
		"nested-tracing: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"nested-tracing: response time < 2000ms": (r) => r.timings.duration < 2000,
	});

	if (basicChecks) {
		try {
			const data = JSON.parse(response.body);

			if (response.status === 200 && data.success) {
				const responseData = data.data;

				// Record timing metrics
				tracingNestedOperationsTime.add(responseData.total_execution_time_ms, {
					child_count: payload.child_operations.length,
				});

				// Success rate
				tracingSuccessRate.add(1);

				console.log(
					`   ✅ Success: Nested operations | Children: ${responseData.child_results.length} | Time: ${responseData.total_execution_time_ms}ms`,
				);

				// Detailed checks for nested operations
				const nestedChecks = check(response, {
					"nested-tracing: has parent span ID": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data.trace_hierarchy &&
							data.data.trace_hierarchy.parent_span_id
						);
					},
					"nested-tracing: has child span IDs": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data.trace_hierarchy &&
							Array.isArray(data.data.trace_hierarchy.child_span_ids) &&
							data.data.trace_hierarchy.child_span_ids.length > 0
						);
					},
					"nested-tracing: child results match operations": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data.child_results &&
							data.data.child_results.length === payload.child_operations.length
						);
					},
					"nested-tracing: all children have execution time": (r) => {
						const data = JSON.parse(r.body);
						return data.data.child_results.every(
							(child) =>
								child.execution_time_ms > 0 &&
								child.attributes_inherited === true,
						);
					},
				});

				return {
					success: true,
					children_count: responseData.child_results.length,
					response_time: response.timings.duration,
				};
			} else {
				tracingSuccessRate.add(0);
				console.log(
					`   ❌ Failed: Nested operations - Status: ${response.status}`,
				);
				return { success: false, error: data.error || "Unknown error" };
			}
		} catch (parseError) {
			tracingSuccessRate.add(0);
			console.log(`   ❌ JSON Parse Error: Nested operations`);
			return { success: false, error: "JSON parse error" };
		}
	} else {
		tracingSuccessRate.add(0);
		console.log(
			`   ❌ Basic Checks Failed: Nested operations - Status: ${response.status}`,
		);
		return { success: false, error: "Basic checks failed" };
	}
}

/**
 * Execute mixed tracing scenarios
 */
export function executeMixedTracingScenarios(baseUrl, session) {
	// 70% attributes test, 30% nested test
	const useAttributesTest = Math.random() < 0.7;

	if (useAttributesTest) {
		return executeTracingAttributesTest(baseUrl, session);
	} else {
		return executeNestedTracingTest(baseUrl, session);
	}
}

/**
 * Validate tracing endpoints are available (for setup function)
 */
export function validateTracingEndpoints(baseUrl) {
	console.log("🔍 Validating tracing endpoints...");

	// Test basic connectivity to both tracing endpoints
	const testPayload = {
		operation_type: "data_processing",
		test_payload: {
			size: 10,
			complexity: "simple",
			simulate_processing_time: false,
		},
	};

	const headers = {
		"Content-Type": "application/json",
		"X-User-ID": "test-user-setup",
		"X-User-Session": "test-session-setup",
		"X-Performance-Test": "setup-validation",
	};

	// Test attributes endpoint
	const attributesResponse = http.post(
		`${baseUrl}/v1/tracing/test-attributes`,
		JSON.stringify(testPayload),
		{ headers, timeout: "10s" },
	);

	// Test nested operations endpoint
	const nestedPayload = {
		parent_operation: "setup_test",
		child_operations: ["setup_child"],
		depth: 1,
	};

	const nestedResponse = http.post(
		`${baseUrl}/v1/tracing/nested-operations`,
		JSON.stringify(nestedPayload),
		{ headers, timeout: "10s" },
	);

	const attributesWorking = attributesResponse.status === 200;
	const nestedWorking = nestedResponse.status === 200;

	if (attributesWorking && nestedWorking) {
		console.log("✅ Tracing endpoints validation passed");
		return true;
	} else {
		console.log(
			`❌ Tracing endpoints validation failed - Attributes: ${attributesWorking}, Nested: ${nestedWorking}`,
		);
		return false;
	}
}
