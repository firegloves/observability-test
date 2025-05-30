import { createDbClient } from "../utils";
import { books } from "./books";
import { users } from "./users";

const seedUsers = async () => {
	const client = createDbClient();
	client.connect();

	try {
		for (const user of users) {
			await client.query(
				"INSERT INTO users (id, email, password_hash, name) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING",
				[user.id, user.email, user.password_hash, user.name],
			);
		}
		console.log("Users inserted or already exists.");
	} catch (err) {
		console.error("Failed to insert users:", err);
	} finally {
		await client.end();
	}
};

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
	await seedUsers();
	await seedBooks();
};

seedDatabase();
