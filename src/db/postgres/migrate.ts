import Postgrator from "postgrator";

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ENV } from "../../env";
import { createDbClient } from "./utils";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
	const client = createDbClient();

	try {
		await client.connect();

		const postgrator = new Postgrator({
			migrationPattern: join(__dirname, "/migration/*"),
			driver: "pg",
			database: ENV.DB_NAME,
			schemaTable: "migrations",
			currentSchema: "public",
			execQuery: (query) => client.query(query),
		});

		const result = await postgrator.migrate();

		if (result.length === 0) {
			console.log(
				'No migrations run for schema "public". Already at the latest one.',
			);
		}

		console.log("Migration done.");

		process.exitCode = 0;
	} catch (err) {
		console.error(err);
		process.exitCode = 1;
	}

	await client.end();
}

// This is a workaround to make the migration script work when run with pnpm run dev
// it is executed when the file is run directly, not when it is imported
if (
	import.meta.url === process.argv[1] ||
	import.meta.url === `file://${process.argv[1]}`
) {
	migrate().catch((err) => {
		console.error("Migration failed:", err);
		process.exit(1);
	});
}

export { migrate };
