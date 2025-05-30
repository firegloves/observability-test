import type { FastifyPluginAsync } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Result } from "oxide.ts";
import { z } from "zod";
import { metrics } from "@opentelemetry/api";

import {
	ERROR_401_RESPONSE_SCHEMA,
	ERROR_404_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
	GENERIC_SUCCESS_RESPONSE_SCHEMA,
} from "../../types";
import { BOOK_SCHEMA, type Book } from "../../../domain/entity/Book";
import type {
	GetBooksError,
	GetBooksUseCase,
} from "../../../domain/use-case/GetBooksUseCase";
import {
	getMeterCounter,
	getMeterHistogram,
} from "../../../observability/metricHelper";
import {
	CREATE_REVIEW_SCHEMA,
	REVIEW_SCHEMA,
	type Review,
} from "../../../domain/entity/Review";
import type { CreateReviewError } from "../../../domain/use-case/CreateReviewUseCase";
import type { CreateReviewUseCase } from "../../../domain/use-case/CreateReviewUseCase";

const reviewCounter = getMeterCounter(
	"reviews_created_total",
	"Total number of reviews created",
);

const reviewDurationHistogram = getMeterHistogram(
	"review_creation_duration_seconds",
	"Duration to create a review in seconds",
);

const SUCCESS_REVIEW_RESPONSE_SCHEMA = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: REVIEW_SCHEMA,
});

const REVIEW_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SUCCESS_REVIEW_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);
type ReviewResponse = z.infer<typeof REVIEW_RESPONSE_SCHEMA>;

const route: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	app.post(
		"/",
		{
			schema: {
				body: CREATE_REVIEW_SCHEMA,
				response: {
					200: SUCCESS_REVIEW_RESPONSE_SCHEMA,
					401: ERROR_401_RESPONSE_SCHEMA,
					404: ERROR_404_RESPONSE_SCHEMA,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<ReviewResponse> => {
			const start = process.hrtime();

			try {
				request.log.info("Creating a review");

				const review = CREATE_REVIEW_SCHEMA.parse(request.body);

				const useCase: CreateReviewUseCase = request.diScope.resolve(
					"createReviewUseCase",
				);

				const result: Result<Review, CreateReviewError> = await useCase.execute(
					review.book_id,
					review.user_id,
					review.rating,
					review.comment,
				);

				const duration = process.hrtime(start);
				const seconds = duration[0] + duration[1] / 1e9;

				reviewCounter.add(1, { route: "/reviews" });
				reviewDurationHistogram.record(seconds, { success: "true" });

				if (result.isErr()) {
					reply.status(500);
					return {
						success: false,
						error: result.unwrapErr(),
					};
				}

				request.log.info(
					{ count: result.unwrap() },
					"Review created successfully",
				);
				reply.status(200);
				return {
					success: true,
					data: result.unwrap(),
				};
			} catch (error) {
				const duration = process.hrtime(start);
				const seconds = duration[0] + duration[1] / 1e9;
				reviewDurationHistogram.record(seconds, { success: "false" });

				request.log.error(
					{ err: error, body: request.body },
					"Failed to create review",
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
