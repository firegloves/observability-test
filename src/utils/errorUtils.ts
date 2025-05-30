import type { FastifyBaseLogger } from "fastify";

export const handleError = (
	logger: FastifyBaseLogger,
	error: unknown,
	message: string,
) => {
	if (error instanceof Error) {
		logger.error(error, message);
	} else {
		logger.error(String(error), message);
	}
};
