import type { FastifyBaseLogger } from "fastify";
import type { BookRepo } from "../repository/BookRepo/BookRepo";
import type { GetBooksUseCase } from "../domain/use-case/GetBooksUseCase";
import type { ReviewRepo } from "../repository/ReviewRepo/ReviewRepo";
import type { CreateReviewUseCase } from "../domain/use-case/CreateReviewUseCase";
import type { DatabaseHeavyUseCase } from "../domain/use-case/DatabaseHeavyUseCase";
import type { DatabasePerformanceRepo } from "../repository/DatabasePerformanceRepo/DatabasePerformanceRepo";
import type { CreateReviewAndUpdateBookUseCase } from "../domain/use-case/CreateReviewAndUpdateBookUseCase";

export interface AppContainer {
	logger: FastifyBaseLogger;
	getBooksUseCase: GetBooksUseCase;
	createReviewUseCase: CreateReviewUseCase;
	databaseHeavyUseCase: DatabaseHeavyUseCase;
	bookRepo: BookRepo;
	reviewRepo: ReviewRepo;
	performanceRepo: DatabasePerformanceRepo;
	createReviewAndUpdateBookUseCase: CreateReviewAndUpdateBookUseCase;
}
