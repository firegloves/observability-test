import type { FastifyBaseLogger } from "fastify";
import { Err, Ok } from "oxide.ts";
import type { Result } from "oxide.ts";
import type {
	DatabasePerformanceRepo,
	DatabaseStats,
	HeavyAggregationResult,
} from "../../repository/DatabasePerformanceRepo/DatabasePerformanceRepo";
import type { Book } from "../entity/Book";

export type DatabaseHeavyError = "generic-error" | "invalid-parameters";

export interface DatabaseHeavyRequest {
	operation_type: "complex_join" | "aggregation" | "stats" | "slow_query";
	limit?: number;
	delay_seconds?: number;
	aggregation_type?: string;
}

export interface DatabaseHeavyResponse {
	operation_type: string;
	execution_time_ms: number;
	data:
		| DatabaseStats
		| Book[]
		| HeavyAggregationResult
		| { duration_ms: number };
	metadata: {
		timestamp: string;
		record_count: number;
		performance_impact: "low" | "medium" | "high";
	};
}

/**
 * Use case for database heavy operations testing
 */
export class DatabaseHeavyUseCase {
	private readonly performanceRepo: DatabasePerformanceRepo;
	private readonly logger: FastifyBaseLogger;

	constructor({
		performanceRepo,
		logger,
	}: { performanceRepo: DatabasePerformanceRepo; logger: FastifyBaseLogger }) {
		this.performanceRepo = performanceRepo;
		this.logger = logger;
	}

	async execute(
		request: DatabaseHeavyRequest,
	): Promise<Result<DatabaseHeavyResponse, DatabaseHeavyError>> {
		const start = performance.now();

		this.logger.info(
			`#### Starting database heavy operation: ${request.operation_type}`,
		);

		try {
			let data:
				| DatabaseStats
				| Book[]
				| HeavyAggregationResult
				| { duration_ms: number };
			let record_count = 0;
			let performance_impact: "low" | "medium" | "high" = "medium";

			switch (request.operation_type) {
				case "complex_join": {
					const limit = request.limit || 50;
					data = await this.performanceRepo.findBooksWithComplexJoin(limit);
					record_count = (data as Book[]).length;
					performance_impact = limit > 100 ? "high" : "medium";
					break;
				}

				case "stats": {
					data = await this.performanceRepo.getDetailedDatabaseStats();
					record_count = 1;
					performance_impact = "high"; // Multiple concurrent queries
					break;
				}

				case "aggregation": {
					const aggregation_type = request.aggregation_type || "generic";
					data =
						await this.performanceRepo.performHeavyAggregation(
							aggregation_type,
						);
					record_count = (data as HeavyAggregationResult).result_count;
					performance_impact =
						aggregation_type === "temporal_analysis" ? "high" : "medium";
					break;
				}

				case "slow_query": {
					const delay_seconds = request.delay_seconds || 1;
					if (delay_seconds < 0.1 || delay_seconds > 10) {
						return Err("invalid-parameters");
					}
					data = await this.performanceRepo.simulateSlowQuery(delay_seconds);
					record_count = 1;
					performance_impact =
						delay_seconds > 5 ? "high" : delay_seconds > 2 ? "medium" : "low";
					break;
				}

				default:
					return Err("invalid-parameters");
			}

			const execution_time_ms = performance.now() - start;

			const response: DatabaseHeavyResponse = {
				operation_type: request.operation_type,
				execution_time_ms,
				data,
				metadata: {
					timestamp: new Date().toISOString(),
					record_count,
					performance_impact,
				},
			};

			this.logger.info(
				`#### Database heavy operation completed: ${request.operation_type} in ${execution_time_ms.toFixed(2)}ms`,
			);

			return Ok(response);
		} catch (error) {
			const execution_time_ms = performance.now() - start;
			this.logger.error(
				{ err: error, request, execution_time_ms },
				`#### Database heavy operation failed: ${request.operation_type}`,
			);
			return Err("generic-error");
		}
	}
}
