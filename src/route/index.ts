import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { ROUTE_VERSION_1 } from "./types";
import { healthRoute } from "./health";
import v1Routes from "./v1";

export default fp(async (fastify: FastifyInstance) => {
	// Register health route
	fastify.register(healthRoute);

	// Register all routes from v1/index.ts using Object.entries
	for (const [routeName, routePlugin] of Object.entries(v1Routes)) {
		// Use the route name as the prefix, e.g., /authenticateBasicAuth
		fastify.register(routePlugin, {
			prefix: `/${ROUTE_VERSION_1}/${routeName}`,
		});
	}
});
