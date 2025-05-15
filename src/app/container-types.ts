import type { FastifyBaseLogger } from "fastify";

export interface AppContainer {
	logger: FastifyBaseLogger;
}
