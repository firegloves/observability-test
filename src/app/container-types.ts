import type { FastifyBaseLogger } from "fastify";
import type { BookRepo } from "../repository/BookRepo/BookRepo";
import type { GetBooksUseCase } from "../domain/use-case/GetBooksUseCase";
import type { ReviewRepo } from "../repository/ReviewRepo/ReviewRepo";
import type { CreateReviewUseCase } from "../domain/use-case/CreateReviewUseCase";

export interface AppContainer {
	logger: FastifyBaseLogger;
	getBooksUseCase: GetBooksUseCase;
	createReviewUseCase: CreateReviewUseCase;
	bookRepo: BookRepo;
	reviewRepo: ReviewRepo;
}
