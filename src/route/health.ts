import type { FastifyPluginAsync } from "fastify";

export const healthRoute: FastifyPluginAsync = async (fastify) => {
	fastify.get("/health", async (request, reply) => {
		request.log.info("Health check pinged");
		return { status: "ok", timestamp: new Date().toISOString() };
	});
};
