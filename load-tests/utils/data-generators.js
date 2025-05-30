// Data generators for k6 load tests

/**
 * Generate random latency values for slow endpoint testing
 */
export function randomLatency() {
	const latencies = [100, 250, 500, 1000, 1500, 2000, 3000, 5000];
	return latencies[Math.floor(Math.random() * latencies.length)];
}

/**
 * Generate random operation types for performance testing
 */
export function randomOperationType() {
	const types = ["database", "external_api", "computation", "generic"];
	return types[Math.floor(Math.random() * types.length)];
}

/**
 * Generate weighted operation types (more realistic distribution)
 */
export function weightedOperationType() {
	const random = Math.random();
	if (random < 0.4) return "database"; // 40% database operations
	if (random < 0.7) return "external_api"; // 30% external API calls
	if (random < 0.9) return "computation"; // 20% computation
	return "generic"; // 10% generic operations
}

/**
 * Generate slow endpoint request body
 */
export function generateSlowRequest() {
	return {
		latency_ms: randomLatency(),
		operation_type: weightedOperationType(),
	};
}

/**
 * Generate review data for testing
 */
export function generateReviewData() {
	const ratings = [1, 2, 3, 4, 5];
	const comments = [
		"Great book for testing observability!",
		"Perfect for load testing scenarios",
		"Excellent performance monitoring data",
		"Amazing distributed tracing examples",
		"Outstanding metrics collection",
		"Fantastic error handling patterns",
	];

	return {
		book_id: Math.floor(Math.random() * 10) + 1, // Books 1-10 exist in seeded DB
		user_id: Math.floor(Math.random() * 100) + 1, // Users 1-100 will exist in seeded DB
		rating: ratings[Math.floor(Math.random() * ratings.length)],
		comment: comments[Math.floor(Math.random() * comments.length)],
	};
}

/**
 * Generate think time between requests (human-like behavior)
 */
export function randomThinkTime() {
	// Random think time between 1-5 seconds
	return Math.random() * 4 + 1;
}

/**
 * Generate user session data
 */
export function generateUserSession() {
	return {
		userId: Math.floor(Math.random() * 1000) + 1,
		sessionId: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
		userAgent: `k6-test-user-${Math.floor(Math.random() * 10) + 1}`,
		// Simulate different user behaviors
		behavior: Math.random() < 0.7 ? "normal" : "power_user",
	};
}

/**
 * Get realistic test scenarios distribution
 */
export function getScenarioWeights() {
	return {
		read_heavy: 0.6, // 60% read operations (fetch books)
		write_operations: 0.25, // 25% write operations (create reviews)
		performance_test: 0.1, // 10% performance testing
		error_simulation: 0.05, // 5% error scenarios
	};
}
