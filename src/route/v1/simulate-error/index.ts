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
import { withActiveSpan } from "../../../observability/spanHelper";

const errorCounter = getMeterCounter(
	"simulated_errors_total",
	"Total number of simulated errors triggered manually",
);

const route: FastifyPluginAsync = async (fastify) => {
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	app.get(
		"/simulate-error",
		{
			schema: {
				response: {
					500: GENERIC_ERROR_RESPONSE_SCHEMA,
				},
			},
		},
		async (request, reply): Promise<void> => {
			withActiveSpan("SimulateErrorUseCase", async (span) => {
				const error = new Error(
					"💥 Simulated failure for testing observability",
				);
				errorCounter.add(1, { route: "/simulate-error" });

				request.log.error(error, "Simulated error triggered");

				reply.status(500);
				return {
					success: false,
					error: error.message,
				};
			});
		},
	);
};
export default route;
