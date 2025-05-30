import { z } from "zod";
import { dateStringOrDate } from "../../utils/zodUtils";

export const REVIEW_SCHEMA = z.object({
	id: z.number(),
	user_id: z.number(),
	book_id: z.number(),
	rating: z.number(),
	comment: z.string().nullable(),
	created_at: dateStringOrDate,
});

export type Review = z.infer<typeof REVIEW_SCHEMA>;

export const CREATE_REVIEW_SCHEMA = REVIEW_SCHEMA.omit({
	id: true,
	created_at: true,
});

export type CreateReview = z.infer<typeof CREATE_REVIEW_SCHEMA>;
