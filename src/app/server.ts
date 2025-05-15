import fs from "node:fs";
import path from "node:path";
import { fastifyAwilixPlugin } from "@fastify/awilix";
import FastifyOtelInstrumentation from "@fastify/otel";
import fastifyPostgres from "@fastify/postgres";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUI from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
	type ZodTypeProvider,
	jsonSchemaTransform,
	serializerCompiler,
	validatorCompiler,
} from "fastify-type-provider-zod";
import { z } from "zod";
import { ENV } from "../env";
import routes from "../route";
import { container } from "./container";
import containerPlugin from "./container";

export async function start() {
	// Initialize Fastify with a logger
	const fastify = Fastify({
		logger: true,
	});

	// Create a new variable to have type-safe routes
	const app = fastify.withTypeProvider<ZodTypeProvider>();

	// setup automatic fastify instrumentation
	const fastifyOtelInstrumentation = new FastifyOtelInstrumentation();
	await app.register(fastifyOtelInstrumentation.plugin());

	// Configure Fastify to use Zod for validation and serialization
	app.setValidatorCompiler(validatorCompiler);
	app.setSerializerCompiler(serializerCompiler);

	// Configure OpenAPI schema & Swagger UI
	app.register(fastifySwagger, {
		openapi: {
			info: {
				title: "observability-test",
				description: "Observability Test API",
				version: "1.0.0",
			},
			servers: [],
		},
		transform: jsonSchemaTransform,
	});

	app.register(fastifySwaggerUI, {
		routePrefix: "/docs",
	});

	// register db
	app.register(fastifyPostgres, {
		connectionString: `postgres://${ENV.DB_USER}:${ENV.DB_PASSWORD}@${ENV.DB_HOST}:${ENV.DB_PORT}/${ENV.DB_NAME}`,
	});

	app.register(fastifyAwilixPlugin, {
		container,
		disposeOnClose: true,
		disposeOnResponse: true,
	});

	// Register the container plugin on the app instance which has the type provider and other plugins
	app.register(containerPlugin);

	// Wait for plugins to finish loading to ensure correct loading order
	await app.after();

	// Define routes
	app.route({
		method: "GET",
		url: "/health",
		schema: {
			response: {
				200: z.string(),
			},
		},
		handler: async (_, __) => "Ok",
	});
	app.register(routes);

	// Wait until app is ready to start listening
	await app.ready();

	if (ENV.NODE_ENV !== "production") {
		// Generate OpenAPI schema and save it to a file
		const openApiSpec = JSON.stringify(app.swagger(), null, 2);
		// Ensure the directory exists before writing the file
		const outputDir = path.dirname(ENV.OPENAPI_SPEC_FILE_DESTINATION);
		fs.mkdirSync(outputDir, { recursive: true });
		// Write the file
		fs.writeFileSync(ENV.OPENAPI_SPEC_FILE_DESTINATION, openApiSpec);
	}

	// Run the server
	app
		.listen({ port: ENV.PORT })
		.then((address) => fastify.log.info(`Server listening at ${address}`))
		.catch((err) => {
			fastify.log.fatal(err);
			process.exit(1);
		});
}
