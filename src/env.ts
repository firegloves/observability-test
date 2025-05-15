import { z } from "zod";

const zEnv = z.object({
	PORT: z.coerce.number().default(8080).describe("Port to run the server on"),
	OPENAPI_SPEC_FILE_DESTINATION: z
		.string()
		.default("generated/openapi-schema.json")
		.describe(
			"Path where the OpenAPI specification is generated during development",
		),
	NODE_ENV: z
		.enum(["development", "production", "test"])
		.default("development")
		.describe("In which environment the server is running"),
	DB_HOST: z.string().default("localhost").describe("The host of the database"),
	DB_PORT: z.coerce.number().default(5432).describe("The port of the database"),
	DB_USER: z
		.string()
		.default("library_user")
		.describe("The user of the database"),
	DB_PASSWORD: z
		.string()
		.default("library_password")
		.describe("The password of the database"),
	DB_NAME: z
		.string()
		.default("library_service")
		.describe("The name of the database"),
});

export const ENV = zEnv.parse(process.env);
