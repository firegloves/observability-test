import {
	type AwilixContainer,
	InjectionMode,
	asValue,
	createContainer,
} from "awilix";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import type { AppContainer } from "./container-types";

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
	});
});
