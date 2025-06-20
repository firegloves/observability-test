import type { PostgresDb } from "@fastify/postgres";
import type { FastifyBaseLogger } from "fastify";
import { TraceMethod } from "../../observability/spanHelper";
import { type Book, BOOK_SCHEMA } from "../../domain/entity/Book";
import type { BookRepo } from "./BookRepo";
import { handleError } from "../../utils/errorUtils";

const BOOK_TABLE = "books";

export class PostgresBookRepo implements BookRepo {
	constructor(
		private db: PostgresDb,
		private logger: FastifyBaseLogger,
	) {}

	@TraceMethod()
	async findAll(): Promise<Book[]> {
		try {
			this.logger.info("Looking for all books");

			const res = await this.db.query(
				`SELECT * FROM ${BOOK_TABLE} ORDER BY id DESC LIMIT 100`,
			);

			const books = (res.rows || []).map((row) => BOOK_SCHEMA.parse(row));

			this.logger.info(`${books.length} books found`);

			return books;
		} catch (error: unknown) {
			handleError(this.logger, error, "Error finding books");
			throw error;
		}
	}

	@TraceMethod()
	async updateBook(
		bookId: number,
		averageRating: number,
		reviewCount: number,
	): Promise<Book> {
		try {
			this.logger.info(
				`Updating book ${bookId} with average_rating=${averageRating}, review_count=${reviewCount}`,
			);

			const res = await this.db.query(
				`UPDATE ${BOOK_TABLE} SET average_rating = $1, review_count = $2 WHERE id = $3 RETURNING *`,
				[averageRating, reviewCount, bookId],
			);

			if (!res.rows[0]) {
				throw new Error(`Book with id ${bookId} not found`);
			}

			return BOOK_SCHEMA.parse(res.rows[0]);
		} catch (error: unknown) {
			handleError(this.logger, error, `Error updating book ${bookId}`);
			throw error;
		}
	}
}
