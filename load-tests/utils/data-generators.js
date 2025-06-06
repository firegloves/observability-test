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
		read_heavy: 0.35, // 35% read operations (fetch books) - reduced to accommodate cascading failures
		write_operations: 0.2, // 20% write operations (create reviews)
		performance_test: 0.1, // 10% performance testing (slow endpoint)
		database_heavy: 0.1, // 10% database heavy operations
		cpu_intensive: 0.1, // 10% CPU intensive operations
		error_simulation: 0.1, // 10% comprehensive error scenarios (database errors + timeouts)
		cascading_failure: 0.05, // 5% cascading failure scenarios
	};
}

// =============================================================================
// DATABASE HEAVY OPERATIONS - Data Generators
// =============================================================================

/**
 * Generate database heavy operation types with realistic distribution
 */
export function generateDatabaseHeavyOperation() {
	const operations = [
		{ type: "stats", weight: 0.3 }, // 30% - Database statistics
		{ type: "complex_join", weight: 0.25 }, // 25% - Complex JOIN queries
		{ type: "aggregation", weight: 0.25 }, // 25% - Heavy aggregations
		{ type: "slow_query", weight: 0.2 }, // 20% - Slow query simulation
	];

	const random = Math.random();
	let cumulative = 0;

	for (const op of operations) {
		cumulative += op.weight;
		if (random <= cumulative) {
			return op.type;
		}
	}
	return "stats"; // fallback
}

/**
 * Generate aggregation types for heavy database operations
 */
export function generateAggregationType() {
	const types = [
		"rating_analysis", // Most common
		"author_popularity",
		"temporal_analysis",
		"generic", // Least common
	];
	return types[Math.floor(Math.random() * types.length)];
}

/**
 * Generate complete database heavy request payload
 */
export function generateDatabaseHeavyRequest() {
	const operationType = generateDatabaseHeavyOperation();

	const baseRequest = {
		operation_type: operationType,
	};

	// Add operation-specific parameters
	switch (operationType) {
		case "complex_join":
			return {
				...baseRequest,
				limit: Math.floor(Math.random() * 20) + 5, // 5-25 records
			};

		case "aggregation":
			return {
				...baseRequest,
				aggregation_type: generateAggregationType(),
			};

		case "slow_query":
			return {
				...baseRequest,
				delay_seconds: Math.floor(Math.random() * 3) + 1, // 1-3 seconds
			};

		case "stats":
			return baseRequest; // No additional parameters needed

		default:
			return baseRequest; // fallback for unknown operations
	}
}

// =============================================================================
// CPU INTENSIVE OPERATIONS - Data Generators
// =============================================================================

/**
 * Generate CPU intensive computation types with realistic distribution
 */
export function generateCpuIntensiveOperation() {
	const operations = [
		{ type: "fibonacci", weight: 0.3 }, // 30% - Fibonacci calculations
		{ type: "prime_calculation", weight: 0.3 }, // 30% - Prime number calculations
		{ type: "matrix_operations", weight: 0.25 }, // 25% - Matrix operations
		{ type: "hash_computation", weight: 0.15 }, // 15% - Hash computations
	];

	const random = Math.random();
	let cumulative = 0;

	for (const op of operations) {
		cumulative += op.weight;
		if (random <= cumulative) {
			return op.type;
		}
	}
	return "fibonacci"; // fallback
}

/**
 * Generate CPU intensity levels with realistic distribution
 */
export function generateCpuIntensity() {
	const intensities = [
		{ level: "low", weight: 0.4 }, // 40% - Low intensity
		{ level: "medium", weight: 0.35 }, // 35% - Medium intensity
		{ level: "high", weight: 0.2 }, // 20% - High intensity
		{ level: "extreme", weight: 0.05 }, // 5% - Extreme intensity
	];

	const random = Math.random();
	let cumulative = 0;

	for (const intensity of intensities) {
		cumulative += intensity.weight;
		if (random <= cumulative) {
			return intensity.level;
		}
	}
	return "medium"; // fallback
}

/**
 * Generate complete CPU intensive request payload
 */
export function generateCpuIntensiveRequest() {
	const computationType = generateCpuIntensiveOperation();
	const intensity = generateCpuIntensity();

	const baseRequest = {
		computation_type: computationType,
		intensity: intensity,
	};

	// Occasionally add custom iterations (10% chance)
	if (Math.random() < 0.1) {
		const customIterations = {
			fibonacci: Math.floor(Math.random() * 10) + 25, // 25-35
			prime_calculation: Math.floor(Math.random() * 2000) + 500, // 500-2500
			matrix_operations: Math.floor(Math.random() * 50) + 30, // 30-80
			hash_computation: Math.floor(Math.random() * 3000) + 1000, // 1000-4000
		};

		return {
			...baseRequest,
			iterations: customIterations[computationType],
		};
	}

	return baseRequest;
}
