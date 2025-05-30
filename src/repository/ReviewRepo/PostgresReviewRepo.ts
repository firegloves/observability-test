import type { PostgresDb } from "@fastify/postgres";
import type { FastifyBaseLogger } from "fastify";
import { TraceMethod } from "../../observability/spanHelper";
import {
	type CreateReview,
	type Review,
	REVIEW_SCHEMA,
} from "../../domain/entity/Review";
import type { ReviewRepo } from "./ReviewRepo";
import { handleError } from "../../utils/errorUtils";

const REVIEW_TABLE = "reviews";

export class PostgresReviewRepo implements ReviewRepo {
	constructor(
		private db: PostgresDb,
		private logger: FastifyBaseLogger,
	) {}

	@TraceMethod()
	async insert(review: CreateReview): Promise<Review> {
		try {
			this.logger.info("Inserting a review repository");

			const { rows } = await this.db.query(
				`
				INSERT INTO ${REVIEW_TABLE} (user_id, book_id, rating, comment)
				VALUES ($1, $2, $3, $4)
				RETURNING *
				`,
				[review.user_id, review.book_id, review.rating, review.comment ?? null],
			);

			const newReview = REVIEW_SCHEMA.parse(rows[0]);

			this.logger.info(`Review created: ${newReview.id}`);

			return newReview;
		} catch (error: unknown) {
			handleError(this.logger, error, "Error creating review");
			throw error;
		}
	}
}
