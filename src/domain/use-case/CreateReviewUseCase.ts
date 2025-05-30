import bcrypt from "bcrypt";
import type { FastifyBaseLogger } from "fastify";
import { Err, Ok } from "oxide.ts";
import type { Result } from "oxide.ts";
import type { BookRepo } from "../../repository/BookRepo/BookRepo";
import type { Book } from "../entity/Book";
import type { ReviewRepo } from "../../repository/ReviewRepo/ReviewRepo";
import {
	CREATE_REVIEW_SCHEMA,
	type CreateReview,
	type Review,
} from "../entity/Review";

export type CreateReviewError = "generic-error" | "invalid-review";

/**
 * The authenticate basic auth request use case.
 */
export class CreateReviewUseCase {
	private readonly reviewRepo: ReviewRepo;
	private readonly logger: FastifyBaseLogger;

	constructor({
		reviewRepo,
		logger,
	}: { reviewRepo: ReviewRepo; logger: FastifyBaseLogger }) {
		this.reviewRepo = reviewRepo;
		this.logger = logger;
	}

	async execute(
		book_id: number,
		user_id: number,
		rating: number,
		comment: string | null,
	): Promise<Result<Review, CreateReviewError>> {
		this.logger.info("Creating a review in use case");

		const review: CreateReview = CREATE_REVIEW_SCHEMA.parse({
			book_id,
			user_id,
			rating,
			comment,
		});

		if (!review.comment) {
			return Err("invalid-review");
		}

		try {
			const newReview = await this.reviewRepo.insert(review);

			this.logger.info(`Review created: ${newReview.id}`);

			return Ok(newReview);
		} catch (e) {
			this.logger.error("Error creating review", e);
			return Err("generic-error");
		}
	}
}
