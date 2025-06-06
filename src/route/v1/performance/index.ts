import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";

import {
	ERROR_401_RESPONSE_SCHEMA,
	ERROR_404_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
} from "../../types";
import {
	getMeterCounter,
	getMeterHistogram,
} from "../../../observability/metricHelper";
import { withActiveSpan } from "../../../observability/spanHelper";
import type {
	DatabaseHeavyUseCase,
	DatabaseHeavyError,
	DatabaseHeavyRequest,
	DatabaseHeavyResponse,
} from "../../../domain/use-case/DatabaseHeavyUseCase";
import type { Result } from "oxide.ts";

const slowEndpointCounter = getMeterCounter(
	"slow_endpoint_requests_total",
	"Total number of slow endpoint requests",
);

const slowEndpointDurationHistogram = getMeterHistogram(
	"slow_endpoint_duration_seconds",
	"Duration of slow endpoint requests in seconds",
);

const latencySimulationHistogram = getMeterHistogram(
	"latency_simulation_seconds",
	"Simulated latency duration in seconds",
);

// Database heavy endpoint metrics
const databaseHeavyCounter = getMeterCounter(
	"database_heavy_requests_total",
	"Total number of database heavy requests",
);

const databaseHeavyDurationHistogram = getMeterHistogram(
	"database_heavy_duration_seconds",
	"Duration of database heavy operations in seconds",
);

const databaseQueryExecutionHistogram = getMeterHistogram(
	"database_query_execution_seconds",
	"Database query execution time in seconds",
);

// CPU intensive endpoint metrics
const cpuIntensiveCounter = getMeterCounter(
	"cpu_intensive_requests_total",
	"Total number of CPU intensive requests",
);

const cpuIntensiveDurationHistogram = getMeterHistogram(
	"cpu_intensive_duration_seconds",
	"Duration of CPU intensive operations in seconds",
);

const cpuComputationHistogram = getMeterHistogram(
	"cpu_computation_seconds",
	"CPU computation time in seconds",
);

// Request schema for slow endpoint
const SLOW_REQUEST_SCHEMA = z.object({
	latency_ms: z
		.number()
		.min(100, "Minimum latency is 100ms")
		.max(5000, "Maximum latency is 5000ms")
		.default(1000),
	operation_type: z
		.enum(["database", "external_api", "computation", "generic"])
		.default("generic"),
});

// Request schema for database heavy endpoint
const DATABASE_HEAVY_REQUEST_SCHEMA = z.object({
	operation_type: z
		.enum(["complex_join", "aggregation", "stats", "slow_query"])
		.default("complex_join"),
	limit: z
		.number()
		.min(1, "Minimum limit is 1")
		.max(1000, "Maximum limit is 1000")
		.optional(),
	delay_seconds: z
		.number()
		.min(0.1, "Minimum delay is 0.1 seconds")
		.max(10, "Maximum delay is 10 seconds")
		.optional(),
	aggregation_type: z
		.enum([
			"rating_analysis",
			"author_popularity",
			"temporal_analysis",
			"generic",
		])
		.optional(),
});

// Request schema for CPU intensive endpoint
const CPU_INTENSIVE_REQUEST_SCHEMA = z.object({
	computation_type: z
		.enum([
			"fibonacci",
			"prime_calculation",
			"matrix_operations",
			"hash_computation",
		])
		.default("fibonacci"),
	intensity: z.enum(["low", "medium", "high", "extreme"]).default("medium"),
	iterations: z
		.number()
		.min(1, "Minimum iterations is 1")
		.max(1000000, "Maximum iterations is 1000000")
		.optional(),
});

// Response schemas
const SLOW_RESPONSE_DATA_SCHEMA = z.object({
	requested_latency_ms: z.number(),
	actual_duration_ms: z.number(),
	operation_type: z.string(),
	timestamp: z.string(),
});

const DATABASE_HEAVY_RESPONSE_DATA_SCHEMA = z.object({
	operation_type: z.string(),
	execution_time_ms: z.number(),
	data: z.unknown(), // Can be various types depending on operation
	metadata: z.object({
		timestamp: z.string(),
		record_count: z.number(),
		performance_impact: z.enum(["low", "medium", "high"]),
	}),
});

const CPU_INTENSIVE_RESPONSE_DATA_SCHEMA = z.object({
	computation_type: z.string(),
	intensity: z.string(),
	execution_time_ms: z.number(),
	cpu_utilization_estimate: z.number(),
	result: z.unknown(), // Computation result varies by type
	metadata: z.object({
		timestamp: z.string(),
		iterations_completed: z.number(),
		memory_usage_estimate_mb: z.number(),
		performance_impact: z.enum(["low", "medium", "high", "extreme"]),
	}),
});

const SUCCESS_SLOW_RESPONSE_SCHEMA = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: SLOW_RESPONSE_DATA_SCHEMA,
});

const SUCCESS_DATABASE_HEAVY_RESPONSE_SCHEMA =
	GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
		data: DATABASE_HEAVY_RESPONSE_DATA_SCHEMA,
	});

const SUCCESS_CPU_INTENSIVE_RESPONSE_SCHEMA =
	GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
		data: CPU_INTENSIVE_RESPONSE_DATA_SCHEMA,
	});

const SLOW_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SUCCESS_SLOW_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);

const DATABASE_HEAVY_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SUCCESS_DATABASE_HEAVY_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);

const CPU_INTENSIVE_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SUCCESS_CPU_INTENSIVE_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);

type SlowResponse = z.infer<typeof SLOW_RESPONSE_SCHEMA>;
type SlowRequest = z.infer<typeof SLOW_REQUEST_SCHEMA>;
type DatabaseHeavyResponseType = z.infer<typeof DATABASE_HEAVY_RESPONSE_SCHEMA>;
type CpuIntensiveRequest = z.infer<typeof CPU_INTENSIVE_REQUEST_SCHEMA>;
type CpuIntensiveResponseType = z.infer<typeof CPU_INTENSIVE_RESPONSE_SCHEMA>;

// Utility function to simulate delay
const simulateDelay = async (ms: number): Promise<void> => {
	return new Promise((resolve) => setTimeout(resolve, ms));
};

// CPU-intensive computation functions
const computeFibonacci = (n: number): number => {
	if (n <= 1) return n;
	return computeFibonacci(n - 1) + computeFibonacci(n - 2);
};

const isPrime = (num: number): boolean => {
	if (num <= 1) return false;
	if (num <= 3) return true;
	if (num % 2 === 0 || num % 3 === 0) return false;

	for (let i = 5; i * i <= num; i += 6) {
		if (num % i === 0 || num % (i + 2) === 0) return false;
	}
	return true;
};

const findPrimes = (limit: number): number[] => {
	const primes: number[] = [];
	for (let i = 2; i < limit; i++) {
		if (isPrime(i)) primes.push(i);
	}
	return primes;
};

const multiplyMatrices = (a: number[][], b: number[][]): number[][] => {
	if (!a.length || !b.length || !b[0] || !a[0]) {
		return [];
	}

	const rows = a.length;
	const cols = b[0].length;
	const result: number[][] = Array(rows)
		.fill(null)
		.map(() => Array(cols).fill(0));

	for (let i = 0; i < rows; i++) {
		const resultRow = result[i];
		const aRow = a[i];
		if (resultRow && aRow) {
			for (let j = 0; j < cols; j++) {
				for (let k = 0; k < b.length; k++) {
					const bRow = b[k];
					// @ts-expect-error - we know that the values are numbers
					resultRow[j] += aRow[k] * bRow[j];
				}
			}
		}
	}
	return result;
};

const createMatrix = (size: number): number[][] => {
	const matrix: number[][] = [];
	for (let i = 0; i < size; i++) {
		matrix[i] = [];
		const currentRow = matrix[i] as number[];
		for (let j = 0; j < size; j++) {
			currentRow[j] = Math.random() * 100;
		}
	}
	return matrix;
};

const computeHash = (data: string, iterations: number): string => {
	let hash = data;
	for (let i = 0; i < iterations; i++) {
		hash = require("node:crypto")
			.createHash("sha256")
			.update(hash)
			.digest("hex");
	}
	return hash;
};

const getIntensityParams = (
	intensity: string,
	computationType: string,
): number => {
	const baseParams = {
		low: {
			fibonacci: 30,
			prime_calculation: 1000,
			matrix_operations: 50,
			hash_computation: 1000,
		},
		medium: {
			fibonacci: 35,
			prime_calculation: 5000,
			matrix_operations: 100,
			hash_computation: 5000,
		},
		high: {
			fibonacci: 40,
			prime_calculation: 10000,
			matrix_operations: 150,
			hash_computation: 10000,
		},
		extreme: {
			fibonacci: 42,
			prime_calculation: 50000,
			matrix_operations: 200,
			hash_computation: 50000,
		},
	} as const;

	const intensityConfig = baseParams[intensity as keyof typeof baseParams];
	if (!intensityConfig) {
		throw new Error(`Invalid intensity: ${intensity}`);
	}

	const param =
		intensityConfig[computationType as keyof typeof intensityConfig];
	if (param === undefined) {
		throw new Error(`Invalid computation type: ${computationType}`);
	}

	return param;
};

const route: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	// Existing slow endpoint
	app.post(
		"/slow",
		{
			schema: {
				body: SLOW_REQUEST_SCHEMA,
				response: {
					200: SUCCESS_SLOW_RESPONSE_SCHEMA,
					401: ERROR_401_RESPONSE_SCHEMA,
					404: ERROR_404_RESPONSE_SCHEMA,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<SlowResponse> => {
			const startTime = process.hrtime();
			const requestStart = Date.now();

			try {
				const { latency_ms, operation_type }: SlowRequest = request.body;

				request.log.info(
					{ latency_ms, operation_type },
					"#### Processing slow endpoint request",
				);

				// Increment request counter
				slowEndpointCounter.add(1, {
					operation_type,
					route: "/performance/slow",
				});

				await withActiveSpan(`SlowEndpoint.${operation_type}`, async (span) => {
					// Add custom span attributes
					span.setAttributes({
						"operation.type": operation_type,
						"operation.latency_ms": latency_ms,
						"endpoint.name": "slow",
						"test.scenario": "performance",
					});

					// Record latency simulation start
					const latencyStart = process.hrtime();

					// Simulate the requested latency
					await simulateDelay(latency_ms);

					// Record actual latency simulation duration
					const latencyDuration = process.hrtime(latencyStart);
					const latencySeconds = latencyDuration[0] + latencyDuration[1] / 1e9;
					latencySimulationHistogram.record(latencySeconds, {
						operation_type,
					});

					// Add span event
					span.addEvent("latency_simulation_completed", {
						requested_ms: latency_ms,
						actual_ms: latencySeconds * 1000,
					});
				});

				const actualDuration = Date.now() - requestStart;
				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				// Record total duration
				slowEndpointDurationHistogram.record(totalSeconds, {
					operation_type,
					success: "true",
				});

				request.log.info(
					{
						latency_ms,
						actual_duration_ms: actualDuration,
						operation_type,
					},
					"#### Slow endpoint request completed successfully",
				);

				reply.status(200);
				return {
					success: true,
					data: {
						requested_latency_ms: latency_ms,
						actual_duration_ms: actualDuration,
						operation_type,
						timestamp: new Date().toISOString(),
					},
				};
			} catch (error) {
				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				slowEndpointDurationHistogram.record(totalSeconds, {
					operation_type: "unknown",
					success: "false",
				});

				request.log.error(
					{ err: error, body: request.body },
					"#### Failed to process slow endpoint request",
				);

				reply.status(500);
				return {
					success: false,
					error: "Internal server error",
				};
			}
		},
	);

	// New database heavy endpoint
	app.post(
		"/heavy",
		{
			schema: {
				body: DATABASE_HEAVY_REQUEST_SCHEMA,
				response: {
					200: SUCCESS_DATABASE_HEAVY_RESPONSE_SCHEMA,
					401: ERROR_401_RESPONSE_SCHEMA,
					404: ERROR_404_RESPONSE_SCHEMA,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<DatabaseHeavyResponseType> => {
			const startTime = process.hrtime();

			try {
				const databaseRequest: DatabaseHeavyRequest = request.body;

				request.log.info(
					{
						operation_type: databaseRequest.operation_type,
						limit: databaseRequest.limit,
						delay_seconds: databaseRequest.delay_seconds,
						aggregation_type: databaseRequest.aggregation_type,
					},
					"#### Processing database heavy request",
				);

				// Increment request counter
				databaseHeavyCounter.add(1, {
					operation_type: databaseRequest.operation_type,
					route: "/performance/heavy",
				});

				let result:
					| Result<DatabaseHeavyResponse, DatabaseHeavyError>
					| undefined;

				await withActiveSpan(
					`DatabaseHeavy.${databaseRequest.operation_type}`,
					async (span) => {
						// Add custom span attributes
						span.setAttributes({
							"operation.type": databaseRequest.operation_type,
							"operation.limit": databaseRequest.limit || 0,
							"operation.delay_seconds": databaseRequest.delay_seconds || 0,
							"operation.aggregation_type":
								databaseRequest.aggregation_type || "none",
							"endpoint.name": "heavy",
							"test.scenario": "database_performance",
						});

						// Get use case and execute
						const useCase: DatabaseHeavyUseCase = request.diScope.resolve(
							"databaseHeavyUseCase",
						);
						result = await useCase.execute(databaseRequest);

						// Add span event with results
						if (result.isOk()) {
							const response = result.unwrap();
							span.addEvent("database_operation_completed", {
								execution_time_ms: response.execution_time_ms,
								record_count: response.metadata.record_count,
								performance_impact: response.metadata.performance_impact,
							});

							// Record database execution time
							databaseQueryExecutionHistogram.record(
								response.execution_time_ms / 1000,
								{
									operation_type: databaseRequest.operation_type,
									performance_impact: response.metadata.performance_impact,
								},
							);
						}
					},
				);

				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				if (!result || result.isErr()) {
					databaseHeavyDurationHistogram.record(totalSeconds, {
						operation_type: databaseRequest.operation_type,
						success: "false",
					});

					reply.status(500);
					return {
						success: false,
						error: result?.unwrapErr() || "unknown-error",
					};
				}

				// Record total duration
				databaseHeavyDurationHistogram.record(totalSeconds, {
					operation_type: databaseRequest.operation_type,
					success: "true",
				});

				const response = result.unwrap();

				request.log.info(
					{
						operation_type: databaseRequest.operation_type,
						execution_time_ms: response.execution_time_ms,
						record_count: response.metadata.record_count,
						performance_impact: response.metadata.performance_impact,
					},
					"#### Database heavy request completed successfully",
				);

				reply.status(200);
				return {
					success: true,
					data: response,
				};
			} catch (error) {
				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				databaseHeavyDurationHistogram.record(totalSeconds, {
					operation_type: "unknown",
					success: "false",
				});

				request.log.error(
					{ err: error, body: request.body },
					"#### Failed to process database heavy request",
				);

				reply.status(500);
				return {
					success: false,
					error: "Internal server error",
				};
			}
		},
	);

	// New CPU intensive endpoint
	app.post(
		"/cpu",
		{
			schema: {
				body: CPU_INTENSIVE_REQUEST_SCHEMA,
				response: {
					200: SUCCESS_CPU_INTENSIVE_RESPONSE_SCHEMA,
					401: ERROR_401_RESPONSE_SCHEMA,
					404: ERROR_404_RESPONSE_SCHEMA,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<CpuIntensiveResponseType> => {
			const startTime = process.hrtime();
			const memoryBefore = process.memoryUsage();

			try {
				const { computation_type, intensity, iterations }: CpuIntensiveRequest =
					request.body;

				request.log.info(
					{ computation_type, intensity, iterations },
					"#### Processing CPU intensive request",
				);

				// Increment request counter
				cpuIntensiveCounter.add(1, {
					computation_type,
					intensity,
					route: "/performance/cpu",
				});

				let result: unknown;
				let iterationsCompleted = 0;
				let cpuUtilization = 0;

				await withActiveSpan(
					`CpuIntensive.${computation_type}`,
					async (span) => {
						// Add custom span attributes
						span.setAttributes({
							"operation.type": computation_type,
							"operation.intensity": intensity,
							"operation.iterations": iterations || 0,
							"endpoint.name": "cpu",
							"test.scenario": "cpu_performance",
						});

						const computationStart = process.hrtime();

						try {
							// Get parameters based on intensity or use custom iterations
							const param =
								iterations || getIntensityParams(intensity, computation_type);

							switch (computation_type) {
								case "fibonacci": {
									result = computeFibonacci(param);
									iterationsCompleted = 1;
									break;
								}
								case "prime_calculation": {
									result = findPrimes(param);
									iterationsCompleted = param;
									break;
								}
								case "matrix_operations": {
									const matrixA = createMatrix(param);
									const matrixB = createMatrix(param);
									result = multiplyMatrices(matrixA, matrixB);
									iterationsCompleted = param * param; // Matrix size squared
									break;
								}
								case "hash_computation": {
									result = computeHash(`test-data-${Date.now()}`, param);
									iterationsCompleted = param;
									break;
								}
								default:
									throw new Error(
										`Unknown computation type: ${computation_type}`,
									);
							}
						} catch (computationError) {
							span.addEvent("computation_error", {
								error:
									computationError instanceof Error
										? computationError.message
										: "Unknown error",
							});
							throw computationError;
						}

						const computationDuration = process.hrtime(computationStart);
						const computationSeconds =
							computationDuration[0] + computationDuration[1] / 1e9;

						// Record computation time
						cpuComputationHistogram.record(computationSeconds, {
							computation_type,
							intensity,
						});

						// Estimate CPU utilization (simplified)
						cpuUtilization = Math.min(100, computationSeconds * 20);

						// Add span event with results
						span.addEvent("cpu_computation_completed", {
							execution_time_ms: computationSeconds * 1000,
							iterations_completed: iterationsCompleted,
							cpu_utilization_estimate: cpuUtilization,
							performance_impact: intensity,
						});
					},
				);

				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;
				const memoryAfter = process.memoryUsage();
				const memoryUsedMb =
					(memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024;

				// Record total duration
				cpuIntensiveDurationHistogram.record(totalSeconds, {
					computation_type,
					intensity,
					success: "true",
				});

				request.log.info(
					{
						computation_type,
						intensity,
						execution_time_ms: totalSeconds * 1000,
						iterations_completed: iterationsCompleted,
						cpu_utilization_estimate: cpuUtilization,
						memory_used_mb: memoryUsedMb,
					},
					"#### CPU intensive request completed successfully",
				);

				reply.status(200);
				return {
					success: true,
					data: {
						computation_type,
						intensity,
						execution_time_ms: totalSeconds * 1000,
						cpu_utilization_estimate: cpuUtilization,
						result,
						metadata: {
							timestamp: new Date().toISOString(),
							iterations_completed: iterationsCompleted,
							memory_usage_estimate_mb: Math.max(0, memoryUsedMb),
							performance_impact: intensity as
								| "low"
								| "medium"
								| "high"
								| "extreme",
						},
					},
				};
			} catch (error) {
				const totalDuration = process.hrtime(startTime);
				const totalSeconds = totalDuration[0] + totalDuration[1] / 1e9;

				cpuIntensiveDurationHistogram.record(totalSeconds, {
					computation_type: "unknown",
					intensity: "unknown",
					success: "false",
				});

				request.log.error(
					{ err: error, body: request.body },
					"#### Failed to process CPU intensive request",
				);

				reply.status(500);
				return {
					success: false,
					error: "Internal server error",
				};
			}
		},
	);
};

export default route;
