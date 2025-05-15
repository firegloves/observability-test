import { z } from "zod";

export const dateStringOrDate = z.preprocess((val) => {
	if (typeof val === "string") return new Date(val);
	if (val instanceof Date) return val;
	return val;
}, z.date());

/**
 * Convert a snake_case string to a camelCase string.
 * used to convert the db column names to the property names.
 */
const snakeToCamel = (s: string) =>
	s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
export const snaketoCamelCasePreprocessor = (obj: unknown) => {
	if (typeof obj !== "object" || obj === null) return obj;
	return Object.entries(obj).reduce(
		(acc, [k, v]) => {
			acc[snakeToCamel(k)] = v;
			return acc;
		},
		{} as Record<string, unknown>,
	);
};
