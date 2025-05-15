import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ROUTE_VERSION_1 } from "./types";
import { healthRoute } from "./health";

export default fp(async (fastify: FastifyInstance) => {
	// Register health route
	fastify.register(healthRoute);
});
