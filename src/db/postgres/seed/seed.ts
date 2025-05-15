import { createDbClient } from "../utils";
import { books } from "./books";

const seedBooks = async () => {
	const client = createDbClient();
	client.connect();

	try {
		for (const book of books) {
			await client.query(
				"INSERT INTO books (title, author, published_at) VALUES ($1, $2, $3) ON CONFLICT (title) DO NOTHING",
				[book.title, book.author, book.published_at],
			);
		}
		console.log("Books inserted or already exists.");
	} catch (err) {
		console.error("Failed to insert books:", err);
	} finally {
		await client.end();
	}
};

export const seedDatabase = async () => {
	await seedBooks();
};

seedDatabase();
