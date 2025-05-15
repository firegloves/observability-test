import pg from "pg";
import { ENV } from "../../env";

export const createDbClient = () => {
	return new pg.Client({
		host: ENV.DB_HOST,
		port: ENV.DB_PORT,
		user: ENV.DB_USER,
		password: ENV.DB_PASSWORD,
		database: ENV.DB_NAME,
	});
};
