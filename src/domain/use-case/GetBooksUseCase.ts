import bcrypt from "bcrypt";
import type { FastifyBaseLogger } from "fastify";
import { Err, Ok } from "oxide.ts";
import type { Result } from "oxide.ts";
import type { BookRepo } from "../../repository/BookRepo/BookRepo";
import type { Book } from "../entity/Book";

export type GetBooksError = "generic-error";

/**
 * The authenticate basic auth request use case.
 */
export class GetBooksUseCase {
	private readonly bookRepo: BookRepo;
	private readonly logger: FastifyBaseLogger;

	constructor({
		bookRepo,
		logger,
	}: { bookRepo: BookRepo; logger: FastifyBaseLogger }) {
		this.bookRepo = bookRepo;
		this.logger = logger;
	}

	async execute(): Promise<Result<Book[], GetBooksError>> {
		this.logger.info("Getting books in use case");

		try {
			const books = await this.bookRepo.findAll();

			this.logger.info(`Found ${books.length} books`);

			return Ok(books);
		} catch (e) {
			this.logger.error("Error getting books", e);
			return Err("generic-error");
		}
	}
}
