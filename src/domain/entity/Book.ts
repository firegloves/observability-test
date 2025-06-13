import { z } from "zod";
import { dateStringOrDate } from "../../utils/zodUtils";

export const BOOK_SCHEMA = z.object({
	id: z.number(),
	title: z.string(),
	author: z.string(),
	published_at: dateStringOrDate,
	created_at: dateStringOrDate,
	average_rating: z.number().default(0),
	review_count: z.number().default(0),
});

export type Book = z.infer<typeof BOOK_SCHEMA>;
