import { z } from "zod";

export const ROUTE_VERSION_1 = "v1";

/**
 * ensure single response schema for all routes by defining a generic response schema
 * and then discriminating on the success property
 */

const RESPONSE_AUTH_TYPE_FIELD = "success";

// 1. Define the specific schemas first
export const GENERIC_SUCCESS_RESPONSE_SCHEMA = z.object({
	success: z.literal(true),
	data: z.unknown(),
});

export const GENERIC_ERROR_RESPONSE_SCHEMA = z.object({
	success: z.literal(false),
	error: z.string(),
});

export const ERROR_404_RESPONSE_SCHEMA = GENERIC_ERROR_RESPONSE_SCHEMA.extend({
	error: z.literal("Resource not found"),
});

// 2. Build the discriminated union from the specific schemas
export const GENERIC_RESPONSE_SCHEMA = z.discriminatedUnion(
	RESPONSE_AUTH_TYPE_FIELD,
	[GENERIC_SUCCESS_RESPONSE_SCHEMA, GENERIC_ERROR_RESPONSE_SCHEMA],
);
