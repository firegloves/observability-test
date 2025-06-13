import type { Option } from "oxide.ts";
import type { CreateReview, Review } from "../../domain/entity/Review";

export interface ReviewRepo {
	insert(review: CreateReview): Promise<Review>;
	findByBookId(bookId: number): Promise<Review[]>;
}
