import http from "k6/http";
import { check } from "k6";
import { Trend, Counter, Rate } from "k6/metrics";

// Custom metrics for HTTP error scenarios
export const httpErrorRequestsTotal = new Counter("http_error_requests_total");
export const httpErrorResponseTime = new Trend("http_error_response_time");
export const httpErrorSuccessRate = new Rate("http_error_success_rate");
export const httpError4xxCount = new Counter("http_error_4xx_count");
export const httpError5xxCount = new Counter("http_error_5xx_count");
export const httpErrorIntermittentSuccessCount = new Counter(
	"http_error_intermittent_success_count",
);
export const httpErrorRetryableCount = new Counter(
	"http_error_retryable_count",
);

// HTTP Error scenarios configuration
const HTTP_ERROR_SCENARIOS = {
	// 4xx Client Errors
	bad_request: {
		error_code: 400,
		category: "4xx",
		weight: 15, // 15% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	unauthorized: {
		error_code: 401,
		category: "4xx",
		weight: 10, // 10% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	forbidden: {
		error_code: 403,
		category: "4xx",
		weight: 8, // 8% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	not_found: {
		error_code: 404,
		category: "4xx",
		weight: 12, // 12% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	conflict: {
		error_code: 409,
		category: "4xx",
		weight: 5, // 5% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	unprocessable_entity: {
		error_code: 422,
		category: "4xx",
		weight: 7, // 7% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	too_many_requests: {
		error_code: 429,
		category: "4xx",
		weight: 8, // 8% of requests
		expected_success: false,
		simulate_intermittent: false,
	},

	// 5xx Server Errors
	internal_server_error: {
		error_code: 500,
		category: "5xx",
		weight: 10, // 10% of requests
		expected_success: false,
		simulate_intermittent: true,
		intermittent_success_rate: 0.15, // 15% success rate
	},
	bad_gateway: {
		error_code: 502,
		category: "5xx",
		weight: 8, // 8% of requests
		expected_success: false,
		simulate_intermittent: true,
		intermittent_success_rate: 0.1, // 10% success rate
	},
	service_unavailable: {
		error_code: 503,
		category: "5xx",
		weight: 7, // 7% of requests
		expected_success: false,
		simulate_intermittent: true,
		intermittent_success_rate: 0.2, // 20% success rate
	},
	gateway_timeout: {
		error_code: 504,
		category: "5xx",
		weight: 5, // 5% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	insufficient_storage: {
		error_code: 507,
		category: "5xx",
		weight: 3, // 3% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
	loop_detected: {
		error_code: 508,
		category: "5xx",
		weight: 2, // 2% of requests
		expected_success: false,
		simulate_intermittent: false,
	},
};

/**
 * Select a random HTTP error scenario based on weights
 */
function selectHttpErrorScenario() {
	const scenarios = Object.keys(HTTP_ERROR_SCENARIOS);
	const weights = scenarios.map((key) => HTTP_ERROR_SCENARIOS[key].weight);

	// Calculate total weight
	const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

	// Generate random number
	const random = Math.random() * totalWeight;

	// Select scenario based on weight
	let cumulativeWeight = 0;
	for (let i = 0; i < scenarios.length; i++) {
		cumulativeWeight += weights[i];
		if (random <= cumulativeWeight) {
			return scenarios[i];
		}
	}

	// Fallback to first scenario
	return scenarios[0];
}

/**
 * Execute HTTP error scenario simulation
 */
export function executeHttpErrorScenario(baseUrl) {
	const scenarioName = selectHttpErrorScenario();
	const scenario = HTTP_ERROR_SCENARIOS[scenarioName];

	httpErrorRequestsTotal.add(1, {
		scenario: scenarioName,
		error_code: scenario.error_code.toString(),
		category: scenario.category,
	});

	const requestPayload = {
		error_code: scenario.error_code,
		category: scenario.category,
		include_delay: true,
		simulate_intermittent: scenario.simulate_intermittent || false,
		intermittent_success_rate: scenario.intermittent_success_rate || 0.1,
		custom_message: `Test simulation for ${scenario.error_code} error`,
	};

	const startTime = Date.now();

	const response = http.post(
		`${baseUrl}/v1/errors/http-errors`,
		JSON.stringify(requestPayload),
		{
			headers: {
				"Content-Type": "application/json",
			},
			timeout: "30s",
		},
	);

	const responseTime = Date.now() - startTime;
	httpErrorResponseTime.add(responseTime, {
		scenario: scenarioName,
		error_code: scenario.error_code.toString(),
	});

	// Check response based on scenario expectations
	const isExpectedError = response.status === scenario.error_code;
	const isIntermittentSuccess =
		response.status === 200 && scenario.simulate_intermittent;
	const isValidResponse = isExpectedError || isIntermittentSuccess;

	// Track success rate
	httpErrorSuccessRate.add(isValidResponse, {
		scenario: scenarioName,
		error_code: scenario.error_code.toString(),
	});

	// Track by category
	if (scenario.category === "4xx") {
		httpError4xxCount.add(1, { error_code: scenario.error_code.toString() });
	} else if (scenario.category === "5xx") {
		httpError5xxCount.add(1, { error_code: scenario.error_code.toString() });
	}

	// Track intermittent successes
	if (isIntermittentSuccess) {
		httpErrorIntermittentSuccessCount.add(1, {
			scenario: scenarioName,
			error_code: scenario.error_code.toString(),
		});
	}

	// Track retryable errors
	if (response.status >= 500 || [409, 429].includes(response.status)) {
		httpErrorRetryableCount.add(1, {
			error_code: response.status.toString(),
			retryable: "true",
		});
	}

	// Perform checks
	const checks = check(
		response,
		{
			"HTTP error simulation response is valid": () => isValidResponse,
			"Response time is acceptable": () => responseTime < 30000,
			"Response has proper structure": () => {
				if (response.status === 200) {
					// Success response (intermittent)
					const body = JSON.parse(response.body || "{}");
					return body.success === true && body.data && body.data.request_id;
				} else {
					// Error response
					const body = JSON.parse(response.body || "{}");
					return body.success === false && body.error && body.error_details;
				}
			},
			"Expected error code matches": () => {
				if (scenario.simulate_intermittent && response.status === 200) {
					return true; // Intermittent success is expected
				}
				return response.status === scenario.error_code;
			},
			"Error details are present": () => {
				if (response.status === 200) return true; // Success case
				const body = JSON.parse(response.body || "{}");
				return (
					body.error_details &&
					body.error_details.attempted_error_code &&
					body.error_details.scenario_name &&
					body.error_details.retry_recommendation
				);
			},
			"Proper headers for specific errors": () => {
				// Check for specific headers based on error code
				switch (scenario.error_code) {
					case 401:
						return response.headers["WWW-Authenticate"] !== undefined;
					case 429:
						return response.headers["Retry-After"] !== undefined;
					case 503:
						return response.headers["Retry-After"] !== undefined;
					default:
						return true; // No specific header requirements
				}
			},
		},
		{
			scenario: scenarioName,
			error_code: scenario.error_code.toString(),
			category: scenario.category,
		},
	);

	// Log detailed information for debugging
	if (!isValidResponse) {
		console.error(`❌ HTTP Error Scenario Failed:`, {
			scenario: scenarioName,
			expected_code: scenario.error_code,
			actual_status: response.status,
			simulate_intermittent: scenario.simulate_intermittent,
			response_time_ms: responseTime,
			body: response.body ? response.body.substring(0, 200) : "No body",
		});
	} else {
		console.log(`✅ HTTP Error Scenario Success:`, {
			scenario: scenarioName,
			status: response.status,
			category: scenario.category,
			response_time_ms: responseTime,
			intermittent: isIntermittentSuccess ? "success" : "error",
		});
	}

	return {
		success: isValidResponse,
		scenario: scenarioName,
		error_code: scenario.error_code,
		actual_status: response.status,
		response_time: responseTime,
		intermittent_success: isIntermittentSuccess,
	};
}

/**
 * Execute mixed HTTP error scenario (random category)
 */
export function executeMixedHttpErrorScenario(baseUrl) {
	// Select random category or specific error code
	const categories = ["4xx", "5xx", "all"];
	const selectedCategory =
		categories[Math.floor(Math.random() * categories.length)];

	httpErrorRequestsTotal.add(1, {
		scenario: "mixed_http_errors",
		category: selectedCategory,
	});

	const requestPayload = {
		category: selectedCategory,
		include_delay: Math.random() > 0.3, // 70% chance of delay
		simulate_intermittent: Math.random() > 0.7, // 30% chance of intermittent
		intermittent_success_rate: 0.1 + Math.random() * 0.2, // 10-30% success rate
	};

	const startTime = Date.now();

	const response = http.post(
		`${baseUrl}/v1/errors/http-errors`,
		JSON.stringify(requestPayload),
		{
			headers: {
				"Content-Type": "application/json",
			},
			timeout: "30s",
		},
	);

	const responseTime = Date.now() - startTime;
	httpErrorResponseTime.add(responseTime, {
		scenario: "mixed_http_errors",
		category: selectedCategory,
	});

	// Determine if response is valid
	const isSuccess = response.status === 200;
	const isClientError = response.status >= 400 && response.status < 500;
	const isServerError = response.status >= 500 && response.status < 600;
	const isValidResponse = isSuccess || isClientError || isServerError;

	// Track success rate
	httpErrorSuccessRate.add(isValidResponse, {
		scenario: "mixed_http_errors",
		category: selectedCategory,
	});

	// Track by category
	if (isClientError) {
		httpError4xxCount.add(1, { error_code: response.status.toString() });
	} else if (isServerError) {
		httpError5xxCount.add(1, { error_code: response.status.toString() });
	}

	// Track intermittent successes
	if (isSuccess && requestPayload.simulate_intermittent) {
		httpErrorIntermittentSuccessCount.add(1, {
			scenario: "mixed_http_errors",
			category: selectedCategory,
		});
	}

	// Perform checks
	const checks = check(
		response,
		{
			"Mixed HTTP error response is valid": () => isValidResponse,
			"Response time is acceptable": () => responseTime < 30000,
			"Response has proper structure": () => {
				const body = JSON.parse(response.body || "{}");
				if (response.status === 200) {
					return body.success === true && body.data;
				} else {
					return body.success === false && body.error;
				}
			},
			"Category matches when specified": () => {
				if (selectedCategory === "all") return true;
				if (selectedCategory === "4xx")
					return response.status >= 400 && response.status < 500;
				if (selectedCategory === "5xx")
					return response.status >= 500 && response.status < 600;
				return true;
			},
		},
		{
			scenario: "mixed_http_errors",
			category: selectedCategory,
			actual_status: response.status.toString(),
		},
	);

	return {
		success: isValidResponse,
		scenario: "mixed_http_errors",
		category: selectedCategory,
		actual_status: response.status,
		response_time: responseTime,
		is_success: isSuccess,
	};
}

/**
 * Get HTTP error scenarios list
 */
export function getHttpErrorScenarios(baseUrl) {
	const response = http.get(`${baseUrl}/v1/errors/http-errors/scenarios`);

	const isSuccess = check(response, {
		"HTTP error scenarios list retrieved": (r) => r.status === 200,
		"Response has scenarios data": (r) => {
			const body = JSON.parse(r.body || "{}");
			return body.success && body.data && body.data.scenarios;
		},
		"Categories are present": (r) => {
			const body = JSON.parse(r.body || "{}");
			return (
				body.data &&
				body.data.categories &&
				body.data.categories["4xx"] &&
				body.data.categories["5xx"]
			);
		},
	});

	if (isSuccess) {
		const body = JSON.parse(response.body);
		console.log(`📋 Available HTTP Error Scenarios:`, {
			total: body.data.total_scenarios,
			categories: body.data.categories,
			first_few: body.data.scenarios
				.slice(0, 3)
				.map((s) => `${s.error_code}: ${s.name}`),
		});
	}

	return response;
}
