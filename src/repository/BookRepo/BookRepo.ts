import type { Option } from "oxide.ts";
import type { Book } from "../../domain/entity/Book";

export interface BookRepo {
	findAll(): Promise<Book[]>;
}
