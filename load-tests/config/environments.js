// Environment configurations for k6 load tests

export const environments = {
	local: {
		baseUrl: "http://localhost:8081",
		rpsThreshold: 100,
		errorRateThreshold: 0.1,
		p95Threshold: 500,
	},
	staging: {
		baseUrl: "https://staging.observability-test.com",
		rpsThreshold: 200,
		errorRateThreshold: 0.05,
		p95Threshold: 300,
	},
	production: {
		baseUrl: "https://api.observability-test.com",
		rpsThreshold: 500,
		errorRateThreshold: 0.01,
		p95Threshold: 200,
	},
};

// Get environment from ENV variable or default to local
export const currentEnv = environments[__ENV.ENVIRONMENT] || environments.local;

// Common test thresholds based on environment
export const getThresholds = () => ({
	http_req_duration: [`p(95)<${currentEnv.p95Threshold}`],
	http_req_failed: [`rate<${currentEnv.errorRateThreshold}`],
	iterations: [`rate>${currentEnv.rpsThreshold}`],
});

// Headers for all requests
export const defaultHeaders = {
	"Content-Type": "application/json",
	"User-Agent": "k6-observability-test/1.0.0",
};

console.log(`🎯 Running tests against: ${currentEnv.baseUrl}`);
