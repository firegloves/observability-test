import type { AppContainer } from "./container-types";

declare module "fastify" {
	interface FastifyRequest {
		diScope: import("awilix").AwilixContainer<AppContainer>;
	}
}
