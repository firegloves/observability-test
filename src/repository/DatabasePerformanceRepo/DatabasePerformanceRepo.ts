import type { Book } from "../../domain/entity/Book";

export interface DatabaseStats {
	total_books: number;
	total_reviews: number;
	avg_rating: number;
	most_reviewed_book: { title: string; review_count: number } | null;
	recent_activity_count: number;
}

export interface HeavyAggregationResult {
	operation_type: string;
	result_count: number;
	execution_time_ms: number;
	data: Record<string, unknown>;
}

export interface DatabasePerformanceRepo {
	// Complex JOIN operations for performance testing
	findBooksWithComplexJoin(limit?: number): Promise<Book[]>;

	// Database statistics aggregation
	getDetailedDatabaseStats(): Promise<DatabaseStats>;

	// Heavy aggregation operations
	performHeavyAggregation(
		operation_type: string,
	): Promise<HeavyAggregationResult>;

	// Slow query simulation
	simulateSlowQuery(delay_seconds: number): Promise<{ duration_ms: number }>;
}
