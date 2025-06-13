import {
	type AwilixContainer,
	InjectionMode,
	asClass,
	asFunction,
	asValue,
	createContainer,
} from "awilix";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { AppContainer } from "./container-types";
import { PostgresBookRepo } from "../repository/BookRepo/PostgresBookRepo";
import { GetBooksUseCase } from "../domain/use-case/GetBooksUseCase";
import { PostgresReviewRepo } from "../repository/ReviewRepo/PostgresReviewRepo";
import { CreateReviewUseCase } from "../domain/use-case/CreateReviewUseCase";
import { DatabaseHeavyUseCase } from "../domain/use-case/DatabaseHeavyUseCase";
import { PostgresDatabasePerformanceRepo } from "../repository/DatabasePerformanceRepo/PostgresDatabasePerformanceRepo";
import { CreateReviewAndUpdateBookUseCase } from "../domain/use-case/CreateReviewAndUpdateBookUseCase";

export const container: AwilixContainer<AppContainer> = createContainer({
	injectionMode: InjectionMode.PROXY,
});

export default fp(async (fastify: FastifyInstance) => {
	const pgDecorator = fastify.pg;
	if (!pgDecorator) {
		throw new Error(
			"fastify.pg decorator is not available in the container plugin",
		);
	}

	container.register({
		logger: asValue(fastify.log),
		getBooksUseCase: asClass(GetBooksUseCase).inject(() => ({
			bookRepo: container.resolve("bookRepo"),
			logger: fastify.log,
		})),
		createReviewUseCase: asClass(CreateReviewUseCase).inject(() => ({
			reviewRepo: container.resolve("reviewRepo"),
			logger: fastify.log,
		})),
		databaseHeavyUseCase: asClass(DatabaseHeavyUseCase).inject(() => ({
			performanceRepo: container.resolve("performanceRepo"),
			logger: fastify.log,
		})),
		bookRepo: asFunction(
			() => new PostgresBookRepo(pgDecorator, fastify.log),
		).scoped(),
		reviewRepo: asFunction(
			() => new PostgresReviewRepo(pgDecorator, fastify.log),
		).scoped(),
		performanceRepo: asFunction(
			() => new PostgresDatabasePerformanceRepo(pgDecorator, fastify.log),
		).scoped(),
		createReviewAndUpdateBookUseCase: asClass(
			CreateReviewAndUpdateBookUseCase,
		).inject(() => ({
			reviewRepo: container.resolve("reviewRepo"),
			bookRepo: container.resolve("bookRepo"),
			logger: fastify.log,
		})),
	});
});
