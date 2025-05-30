import type { PostgresDb } from "@fastify/postgres";
import type { FastifyBaseLogger } from "fastify";
import { TraceMethod } from "../../observability/spanHelper";
import { type Book, BOOK_SCHEMA } from "../../domain/entity/Book";
import type {
	DatabasePerformanceRepo,
	DatabaseStats,
	HeavyAggregationResult,
} from "./DatabasePerformanceRepo";
import { handleError } from "../../utils/errorUtils";

const BOOK_TABLE = "books";
const REVIEW_TABLE = "reviews";
const USER_TABLE = "users";

export class PostgresDatabasePerformanceRepo
	implements DatabasePerformanceRepo
{
	constructor(
		private db: PostgresDb,
		private logger: FastifyBaseLogger,
	) {}

	@TraceMethod()
	async findBooksWithComplexJoin(limit = 50): Promise<Book[]> {
		try {
			this.logger.info(
				"#### Executing complex JOIN query for books with review stats",
			);

			// Fixed SQL: include ORDER BY expressions in SELECT for DISTINCT
			const query = `
				SELECT DISTINCT 
					b.id,
					b.title,
					b.author, 
					b.published_at,
					b.created_at,
					COUNT(r.id) as review_count
				FROM ${BOOK_TABLE} b
				LEFT JOIN ${REVIEW_TABLE} r ON b.id = r.book_id
				LEFT JOIN ${USER_TABLE} u ON r.user_id = u.id
				WHERE b.created_at >= NOW() - INTERVAL '365 days'
				GROUP BY b.id, b.title, b.author, b.published_at, b.created_at
				HAVING COUNT(r.id) >= 0
				ORDER BY review_count DESC, b.title ASC
				LIMIT $1
			`;

			const res = await this.db.query(query, [limit]);
			// Parse only the book fields, ignore review_count
			const books = (res.rows || []).map((row) => {
				const { review_count, ...bookData } = row;
				return BOOK_SCHEMA.parse(bookData);
			});

			this.logger.info(
				`#### Found ${books.length} books with complex JOIN query`,
			);
			return books;
		} catch (error: unknown) {
			handleError(this.logger, error, "Error executing complex JOIN query");
			throw error;
		}
	}

	@TraceMethod()
	async getDetailedDatabaseStats(): Promise<DatabaseStats> {
		try {
			this.logger.info("#### Calculating detailed database statistics");

			// Multiple heavy queries for comprehensive stats
			const [
				booksCount,
				reviewsCount,
				avgRating,
				mostReviewed,
				recentActivity,
			] = await Promise.all([
				this.db.query(`SELECT COUNT(*) as count FROM ${BOOK_TABLE}`),
				this.db.query(`SELECT COUNT(*) as count FROM ${REVIEW_TABLE}`),
				this.db.query(
					`SELECT COALESCE(AVG(rating), 0) as avg_rating FROM ${REVIEW_TABLE}`,
				),
				this.db.query(`
					SELECT b.title, COUNT(r.id) as review_count
					FROM ${BOOK_TABLE} b
					LEFT JOIN ${REVIEW_TABLE} r ON b.id = r.book_id
					GROUP BY b.id, b.title
					ORDER BY review_count DESC
					LIMIT 1
				`),
				this.db.query(`
					SELECT COUNT(*) as count 
					FROM ${REVIEW_TABLE} 
					WHERE created_at >= NOW() - INTERVAL '7 days'
				`),
			]);

			const stats: DatabaseStats = {
				total_books: Number(booksCount.rows[0]?.count || 0),
				total_reviews: Number(reviewsCount.rows[0]?.count || 0),
				avg_rating: Number(avgRating.rows[0]?.avg_rating || 0),
				most_reviewed_book: mostReviewed.rows[0]
					? {
							title: mostReviewed.rows[0].title,
							review_count: Number(mostReviewed.rows[0].review_count),
						}
					: null,
				recent_activity_count: Number(recentActivity.rows[0]?.count || 0),
			};

			this.logger.info(
				`#### Database stats calculated: ${JSON.stringify(stats)}`,
			);
			return stats;
		} catch (error: unknown) {
			handleError(this.logger, error, "Error calculating database stats");
			throw error;
		}
	}

	@TraceMethod()
	async performHeavyAggregation(
		operation_type: string,
	): Promise<HeavyAggregationResult> {
		const start = performance.now();

		try {
			this.logger.info(`#### Performing heavy aggregation: ${operation_type}`);

			let query: string;
			let data: Record<string, unknown> = {};

			switch (operation_type) {
				case "rating_analysis": {
					query = `
						SELECT 
							r.rating,
							COUNT(*) as count,
							AVG(EXTRACT(EPOCH FROM (NOW() - r.created_at)) / 86400) as avg_days_ago,
							STRING_AGG(DISTINCT b.author, ', ') as authors
						FROM ${REVIEW_TABLE} r
						JOIN ${BOOK_TABLE} b ON r.book_id = b.id
						GROUP BY r.rating
						ORDER BY r.rating
					`;
					const ratingRes = await this.db.query(query);
					data = { rating_distribution: ratingRes.rows };
					break;
				}

				case "author_popularity": {
					query = `
						SELECT 
							b.author,
							COUNT(DISTINCT b.id) as books_count,
							COUNT(r.id) as total_reviews,
							COALESCE(AVG(r.rating), 0) as avg_rating,
							MAX(r.created_at) as last_review_date
						FROM ${BOOK_TABLE} b
						LEFT JOIN ${REVIEW_TABLE} r ON b.id = r.book_id
						GROUP BY b.author
						HAVING COUNT(DISTINCT b.id) > 0
						ORDER BY total_reviews DESC, avg_rating DESC
					`;
					const authorRes = await this.db.query(query);
					data = { author_stats: authorRes.rows };
					break;
				}

				case "temporal_analysis": {
					query = `
						SELECT 
							DATE_TRUNC('month', r.created_at) as month,
							COUNT(*) as review_count,
							AVG(r.rating) as avg_rating,
							COUNT(DISTINCT r.user_id) as unique_users,
							COUNT(DISTINCT r.book_id) as unique_books
						FROM ${REVIEW_TABLE} r
						WHERE r.created_at >= NOW() - INTERVAL '12 months'
						GROUP BY DATE_TRUNC('month', r.created_at)
						ORDER BY month DESC
					`;
					const temporalRes = await this.db.query(query);
					data = { monthly_trends: temporalRes.rows };
					break;
				}

				default: {
					// Generic heavy query with multiple JOINs and calculations
					query = `
						SELECT 
							b.id,
							b.title,
							b.author,
							COUNT(r.id) as review_count,
							COALESCE(AVG(r.rating), 0) as avg_rating,
							COALESCE(MAX(r.created_at), b.created_at) as last_activity,
							CASE 
								WHEN COUNT(r.id) = 0 THEN 'No Reviews'
								WHEN AVG(r.rating) >= 4.5 THEN 'Excellent'
								WHEN AVG(r.rating) >= 3.5 THEN 'Good'
								WHEN AVG(r.rating) >= 2.5 THEN 'Average'
								ELSE 'Poor'
							END as rating_category
						FROM ${BOOK_TABLE} b
						LEFT JOIN ${REVIEW_TABLE} r ON b.id = r.book_id
						GROUP BY b.id, b.title, b.author, b.created_at
						ORDER BY review_count DESC, avg_rating DESC
					`;
					const genericRes = await this.db.query(query);
					data = { book_analysis: genericRes.rows };
				}
			}

			const execution_time_ms = performance.now() - start;
			const firstKey = Object.keys(data)[0];
			const result_count =
				firstKey && Array.isArray(data[firstKey])
					? (data[firstKey] as unknown[]).length
					: 1;

			const result: HeavyAggregationResult = {
				operation_type,
				result_count,
				execution_time_ms,
				data,
			};

			this.logger.info(
				`#### Heavy aggregation completed: ${operation_type} in ${execution_time_ms.toFixed(2)}ms`,
			);
			return result;
		} catch (error: unknown) {
			handleError(
				this.logger,
				error,
				`Error performing heavy aggregation: ${operation_type}`,
			);
			throw error;
		}
	}

	@TraceMethod()
	async simulateSlowQuery(
		delay_seconds: number,
	): Promise<{ duration_ms: number }> {
		const start = performance.now();

		try {
			this.logger.info(
				`#### Simulating slow database query with ${delay_seconds}s delay`,
			);

			// Use PostgreSQL's pg_sleep to simulate actual database delay
			await this.db.query("SELECT pg_sleep($1)", [delay_seconds]);

			const duration_ms = performance.now() - start;

			this.logger.info(
				`#### Slow query simulation completed in ${duration_ms.toFixed(2)}ms`,
			);
			return { duration_ms };
		} catch (error: unknown) {
			handleError(
				this.logger,
				error,
				`Error simulating slow query: ${delay_seconds}s`,
			);
			throw error;
		}
	}
}
