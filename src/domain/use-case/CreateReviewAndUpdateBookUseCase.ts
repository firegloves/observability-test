import type { FastifyBaseLogger } from "fastify";
import { Err, Ok } from "oxide.ts";
import type { Result } from "oxide.ts";
import type { BookRepo } from "../../repository/BookRepo/BookRepo";
import type { ReviewRepo } from "../../repository/ReviewRepo/ReviewRepo";
import {
	CREATE_REVIEW_SCHEMA,
	type CreateReview,
	type Review,
} from "../entity/Review";
import type { Book } from "../entity/Book";
import { withActiveSpanWithAttributes } from "../../observability/spanHelper";

export type CreateReviewAndUpdateBookError =
	| "generic-error"
	| "invalid-review"
	| "book-not-found";

export class CreateReviewAndUpdateBookUseCase {
	private readonly reviewRepo: ReviewRepo;
	private readonly bookRepo: BookRepo;
	private readonly logger: FastifyBaseLogger;

	constructor({
		reviewRepo,
		bookRepo,
		logger,
	}: {
		reviewRepo: ReviewRepo;
		bookRepo: BookRepo;
		logger: FastifyBaseLogger;
	}) {
		this.reviewRepo = reviewRepo;
		this.bookRepo = bookRepo;
		this.logger = logger;
	}

	async execute(
		book_id: number,
		user_id: number,
		rating: number,
		comment: string | null,
	): Promise<
		Result<
			{ review: Review; updatedBook: Book },
			CreateReviewAndUpdateBookError
		>
	> {
		return withActiveSpanWithAttributes(
			"CreateReviewAndUpdateBook",
			{ attributes: { book_id, user_id } },
			async (parentSpan) => {
				this.logger.info("[MultiStep] Creating review and updating book");

				// Step 1: crea la review
				const review: CreateReview = CREATE_REVIEW_SCHEMA.parse({
					book_id,
					user_id,
					rating,
					comment,
				});

				if (!review.comment) {
					return Err("invalid-review");
				}

				let newReview: Review;
				try {
					newReview = await this.reviewRepo.insert(review);
					parentSpan.addEvent("review_created", { review_id: newReview.id });
				} catch (e) {
					const err = e instanceof Error ? e : new Error(String(e));
					this.logger.error("[MultiStep] Error creating review", err);
					parentSpan.recordException(err);
					return Err("generic-error");
				}

				// Step 2: aggiorna il libro (rilegge tutte le review per calcolare media e count)
				try {
					const allReviews = await this.reviewRepo.findByBookId(book_id);
					const reviewCount = allReviews.length;
					const averageRating =
						reviewCount > 0
							? allReviews.reduce(
									(sum: number, r: Review) => sum + r.rating,
									0,
								) / reviewCount
							: 0;
					const updatedBook = await this.bookRepo.updateBook(
						book_id,
						averageRating,
						reviewCount,
					);
					parentSpan.addEvent("book_updated", {
						book_id,
						average_rating: averageRating,
						review_count: reviewCount,
					});
					return Ok({ review: newReview, updatedBook });
				} catch (e) {
					const err = e instanceof Error ? e : new Error(String(e));
					this.logger.error("[MultiStep] Error updating book", err);
					parentSpan.recordException(err);
					return Err("book-not-found");
				}
			},
		);
	}
}
