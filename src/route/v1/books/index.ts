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
import { getMeterCounter } from "../../../observability/metricHelper";

const booksFetchedCounter = getMeterCounter(
	"books_fetched_total",
	"Total number of times books have been fetched",
);

const SUCCESS_BOOKS_RESPONSE_SCHEMA = GENERIC_SUCCESS_RESPONSE_SCHEMA.extend({
	data: z.array(BOOK_SCHEMA),
});

const BOOKS_RESPONSE_SCHEMA = z.discriminatedUnion("success", [
	SUCCESS_BOOKS_RESPONSE_SCHEMA,
	GENERIC_ERROR_RESPONSE_SCHEMA,
]);
type BooksResponse = z.infer<typeof BOOKS_RESPONSE_SCHEMA>;

const route: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	app.get(
		"/",
		{
			// TODO: add info about the header
			schema: {
				response: {
					200: SUCCESS_BOOKS_RESPONSE_SCHEMA,
					401: ERROR_401_RESPONSE_SCHEMA,
					404: ERROR_404_RESPONSE_SCHEMA,
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<BooksResponse> => {
			try {
				request.log.info("Getting books in route");

				const useCase: GetBooksUseCase =
					request.diScope.resolve("getBooksUseCase");

				const result: Result<Book[], GetBooksError> = await useCase.execute();

				booksFetchedCounter.add(1, { route: "/books" });

				if (result.isErr()) {
					reply.status(500);
					return {
						success: false,
						error: result.unwrapErr(),
					};
				}

				request.log.info(
					{ count: result.unwrap().length },
					"Books retrieved successfully",
				);
				reply.status(200);
				return {
					success: true,
					data: result.unwrap(),
				};
			} catch (error) {
				request.log.error("Error getting books", error);
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
