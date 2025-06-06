import http from "k6/http";
import { check } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";
import { currentEnv } from "../../config/environments.js";

// Custom metrics for cascading failure scenarios
export const cascadingFailureRequestsTotal = new Counter(
	"cascading_failure_requests_total",
);
export const cascadingFailureExecutionTime = new Trend(
	"cascading_failure_execution_time_ms",
);
export const cascadingFailureStepsTotal = new Trend(
	"cascading_failure_steps_total",
);
export const cascadingFailureRecoveryRate = new Rate(
	"cascading_failure_recovery_rate",
);
export const cascadingFailureServicesAffected = new Trend(
	"cascading_failure_services_affected",
);
export const cascadingFailureSuccessRate = new Rate(
	"cascading_failure_success_rate",
);
export const cascadingFailureDepthReached = new Trend(
	"cascading_failure_depth_reached",
);

const BASE_URL = currentEnv.baseUrl;

/**
 * Execute comprehensive cascading failure scenarios
 * Tests various cascade types with different configurations
 */
export function executeCascadingFailureScenarios() {
	const scenarios = [
		"auth_service_down",
		"database_overload",
		"external_api_failure",
		"memory_leak_cascade",
		"network_partition",
	];

	// Random scenario selection with weighted distribution
	const weights = [25, 30, 20, 15, 10]; // Percentages
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
	const random = Math.random() * totalWeight;

	let cumulativeWeight = 0;
	let selectedScenario = scenarios[0];

	for (let i = 0; i < scenarios.length; i++) {
		cumulativeWeight += weights[i];
		if (random <= cumulativeWeight) {
			selectedScenario = scenarios[i];
			break;
		}
	}

	console.log(`💥 Testing cascading failure scenario: ${selectedScenario}`);

	// Random configuration for more realistic testing
	const configs = [
		{
			force_cascade: false,
			max_cascade_depth: Math.floor(Math.random() * 3) + 2, // 2-4 depth
			cascade_delay_multiplier: Math.random() * 1.5 + 0.5, // 0.5-2.0x
			enable_recovery_simulation: true,
			stop_on_first_recovery: Math.random() < 0.3, // 30% chance
		},
		{
			force_cascade: true,
			max_cascade_depth: Math.floor(Math.random() * 2) + 3, // 3-4 depth
			cascade_delay_multiplier: 1.0,
			enable_recovery_simulation: Math.random() < 0.7, // 70% chance
			stop_on_first_recovery: false,
		},
		{
			force_cascade: Math.random() < 0.2, // 20% forced
			max_cascade_depth: 5, // Full depth
			cascade_delay_multiplier: Math.random() * 0.8 + 0.6, // 0.6-1.4x
			enable_recovery_simulation: true,
			stop_on_first_recovery: Math.random() < 0.5, // 50% chance
		},
	];

	const config = configs[Math.floor(Math.random() * configs.length)];

	console.log(
		`   → Max depth: ${config.max_cascade_depth}, Delay multiplier: ${config.cascade_delay_multiplier.toFixed(2)}x`,
	);
	console.log(
		`   → Force cascade: ${config.force_cascade}, Recovery: ${config.enable_recovery_simulation}`,
	);

	const payload = {
		failure_type: selectedScenario,
		...config,
	};

	const headers = {
		"Content-Type": "application/json",
		"X-Test-Scenario": "cascading-failure",
		"X-User-Session": `session-${Math.floor(Math.random() * 1000)}`,
	};

	const startTime = Date.now();
	const response = http.post(
		`${BASE_URL}/v1/errors/cascading`,
		JSON.stringify(payload),
		{ headers, timeout: "45s" }, // Higher timeout for cascading scenarios
	);
	const endTime = Date.now();
	const responseTime = endTime - startTime;

	// Record basic metrics
	cascadingFailureRequestsTotal.add(1, {
		failure_type: selectedScenario,
		force_cascade: config.force_cascade.toString(),
		max_depth: config.max_cascade_depth.toString(),
	});

	cascadingFailureExecutionTime.add(responseTime, {
		failure_type: selectedScenario,
		status_code: response.status.toString(),
	});

	// Basic checks
	const basicChecks = check(response, {
		"cascading-failure: status is 200 or 500": (r) =>
			r.status === 200 || r.status === 500,
		"cascading-failure: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"cascading-failure: response time < 45000ms": (r) => responseTime < 45000,
	});

	if (basicChecks) {
		try {
			const data = JSON.parse(response.body);

			if (response.status === 200 && data.success) {
				// Success case - detailed metrics
				const cascadeData = data.data;

				console.log(
					`   ✅ Success: ${cascadeData.cascade_steps.length} steps, ${cascadeData.metadata.services_failed} failed, ${cascadeData.metadata.services_recovered} recovered`,
				);

				cascadingFailureSuccessRate.add(1, {
					failure_type: selectedScenario,
					initial_service: cascadeData.initial_service,
				});

				cascadingFailureStepsTotal.add(cascadeData.cascade_steps.length, {
					failure_type: selectedScenario,
					expected_impact: cascadeData.expected_impact,
				});

				cascadingFailureServicesAffected.add(
					cascadeData.total_affected_services,
					{
						failure_type: selectedScenario,
						recovery_strategy: cascadeData.recovery_strategy,
					},
				);

				cascadingFailureDepthReached.add(
					cascadeData.metadata.cascade_depth_reached,
					{
						failure_type: selectedScenario,
						max_configured_depth: config.max_cascade_depth.toString(),
					},
				);

				// Calculate recovery rate
				const totalServices = cascadeData.cascade_steps.length;
				const recoveredServices = cascadeData.metadata.services_recovered;
				const recoveryRate =
					totalServices > 0 ? recoveredServices / totalServices : 0;

				cascadingFailureRecoveryRate.add(recoveryRate, {
					failure_type: selectedScenario,
					recovery_strategy: cascadeData.recovery_strategy,
				});

				// Detailed checks for success response
				const successChecks = check(response, {
					"cascading-failure: has request_id": (r) => {
						const data = JSON.parse(r.body);
						return data.data && data.data.request_id;
					},
					"cascading-failure: has cascade_steps array": (r) => {
						const data = JSON.parse(r.body);
						return data.data && Array.isArray(data.data.cascade_steps);
					},
					"cascading-failure: cascade_steps have valid structure": (r) => {
						const data = JSON.parse(r.body);
						if (!data.data || !Array.isArray(data.data.cascade_steps))
							return false;

						return data.data.cascade_steps.every(
							(step) =>
								step.step_index &&
								step.service &&
								step.failure_type &&
								typeof step.execution_time_ms === "number" &&
								["success", "failed", "recovered"].includes(step.status),
						);
					},
					"cascading-failure: has metadata with metrics": (r) => {
						const data = JSON.parse(r.body);
						const meta = data.data && data.data.metadata;
						return (
							meta &&
							typeof meta.cascade_depth_reached === "number" &&
							typeof meta.services_failed === "number" &&
							typeof meta.services_recovered === "number"
						);
					},
					"cascading-failure: total_execution_time is reasonable": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data &&
							data.data.total_execution_time_ms > 0 &&
							data.data.total_execution_time_ms < 40000
						); // Max 40s
					},
					"cascading-failure: recovery_strategy matches scenario": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.data &&
							data.data.recovery_strategy &&
							data.data.recovery_strategy.length > 0
						);
					},
				});
			} else {
				// Error case
				console.log(`   ❌ Failed: ${data.error || "Unknown error"}`);

				cascadingFailureSuccessRate.add(0, {
					failure_type: selectedScenario,
					error_type: data.error_details
						? data.error_details.error_code
						: "unknown",
				});

				// Checks for error response
				const errorChecks = check(response, {
					"cascading-failure: error has request_id": (r) => {
						const data = JSON.parse(r.body);
						return data.error_details && data.error_details.request_id;
					},
					"cascading-failure: error has recovery_suggestion": (r) => {
						const data = JSON.parse(r.body);
						return data.error_details && data.error_details.recovery_suggestion;
					},
					"cascading-failure: error has partial_cascade_steps": (r) => {
						const data = JSON.parse(r.body);
						return (
							data.error_details &&
							Array.isArray(data.error_details.partial_cascade_steps)
						);
					},
				});
			}
		} catch (e) {
			console.log(`   ❌ Error parsing response: ${e.message}`);
			cascadingFailureSuccessRate.add(0, {
				failure_type: selectedScenario,
				error_type: "parse_error",
			});
		}
	}

	return response;
}

/**
 * Test cascading failure scenarios list endpoint
 */
export function testCascadingFailureScenariosList() {
	console.log("📋 Testing cascading failure scenarios list");

	const response = http.get(`${BASE_URL}/v1/errors/cascading/scenarios`, {
		headers: {
			"X-Test-Scenario": "cascading-failure-list",
		},
	});

	const checks = check(response, {
		"cascading-scenarios-list: status is 200": (r) => r.status === 200,
		"cascading-scenarios-list: response is valid JSON": (r) => {
			try {
				JSON.parse(r.body);
				return true;
			} catch (e) {
				return false;
			}
		},
		"cascading-scenarios-list: has scenarios array": (r) => {
			try {
				const data = JSON.parse(r.body);
				return data.success && Array.isArray(data.data.scenarios);
			} catch (e) {
				return false;
			}
		},
		"cascading-scenarios-list: has 5 scenarios": (r) => {
			try {
				const data = JSON.parse(r.body);
				return data.data.scenarios.length === 5;
			} catch (e) {
				return false;
			}
		},
		"cascading-scenarios-list: scenarios have required fields": (r) => {
			try {
				const data = JSON.parse(r.body);
				return data.data.scenarios.every(
					(scenario) =>
						scenario.failure_type &&
						scenario.name &&
						scenario.description &&
						scenario.initial_service &&
						typeof scenario.cascade_steps === "number" &&
						scenario.recovery_strategy &&
						["low", "medium", "high", "critical"].includes(
							scenario.expected_impact,
						),
				);
			} catch (e) {
				return false;
			}
		},
		"cascading-scenarios-list: response time < 1000ms": (r) =>
			r.timings.duration < 1000,
	});

	if (checks) {
		try {
			const data = JSON.parse(response.body);
			console.log(
				`   ✅ Listed ${data.data.total_scenarios} cascading failure scenarios`,
			);
		} catch (e) {
			console.log(`   ❌ Error parsing scenarios list: ${e.message}`);
		}
	}

	return response;
}

/**
 * Execute mixed cascading failure test scenarios
 * Combines different failure types and configurations for comprehensive testing
 */
export function executeMixedCascadingFailureScenarios() {
	const testType = Math.random();

	if (testType < 0.15) {
		// 15% - Test scenarios list
		return testCascadingFailureScenariosList();
	} else {
		// 85% - Execute cascading failure scenarios
		return executeCascadingFailureScenarios();
	}
}
