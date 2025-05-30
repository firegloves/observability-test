// =============================================================================
// DATABASE HEAVY ONLY - Focused k6 Load Testing
// =============================================================================
// This test file focuses exclusively on database-heavy operations for
// dedicated performance testing and observability analysis.

import { sleep } from "k6";
import { currentEnv, getThresholds } from "../config/environments.js";
import {
	randomThinkTime,
	generateUserSession,
} from "../utils/data-generators.js";
import {
	executeDatabaseHeavyScenario,
	getDatabaseHeavyThresholds,
	databaseHeavyMetrics,
} from "./modules/database-heavy-operations.js";

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

export const options = {
	scenarios: {
		// Focused database heavy testing with realistic load progression
		database_heavy_load: {
			executor: "ramping-vus",
			startVUs: 1,
			stages: [
				{ duration: "1m", target: 5 }, // Ramp up slowly
				{ duration: "3m", target: 15 }, // Steady moderate load
				{ duration: "2m", target: 25 }, // Peak load
				{ duration: "2m", target: 10 }, // Cool down
				{ duration: "1m", target: 0 }, // Complete
			],
		},
	},
	thresholds: {
		...getThresholds(),
		...getDatabaseHeavyThresholds(),
		// Additional focused thresholds for heavy operations
		database_heavy_response_time_ms: [
			"p(50)<1000", // 50th percentile under 1 second
			"p(95)<3000", // 95th percentile under 3 seconds
			"p(99)<5000", // 99th percentile under 5 seconds
		],
		database_heavy_success_total: ["rate>0.95"], // 95% success rate
	},
};

// =============================================================================
// MAIN TEST FUNCTION
// =============================================================================

export default function () {
	// Generate unique user session for each VU
	const session = generateUserSession();

	console.log(
		`🔍 Database Heavy Test - User ${session.userId} starting operation`,
	);

	// Execute database heavy scenario
	const success = executeDatabaseHeavyScenario(session);

	if (!success) {
		console.log(`⚠️  User ${session.userId} encountered issues`);
	}

	// Realistic think time between operations
	sleep(randomThinkTime());
}

// =============================================================================
// TEST LIFECYCLE HOOKS
// =============================================================================

export function setup() {
	console.log("🚀 Starting Database Heavy Load Test");
	console.log(`📍 Target: ${currentEnv.baseUrl}`);
	console.log("📊 Operations: stats, complex_join, aggregation, slow_query");
	console.log("⏱️  Duration: ~9 minutes with load progression");

	// Verify server is accessible before starting
	return { startTime: Date.now() };
}

export function teardown(data) {
	const duration = (Date.now() - data.startTime) / 1000;
	console.log(
		`✅ Database Heavy Load Test completed in ${duration.toFixed(1)}s`,
	);
	console.log("📈 Check your observability platform for detailed metrics!");
}
