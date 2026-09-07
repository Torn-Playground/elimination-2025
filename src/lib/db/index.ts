import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { DATABASE_URL } from "../../config";
import * as schema from "./schema";

export const db = drizzle({
    connection: { uri: DATABASE_URL, timezone: "Z" },
    schema,
    mode: "default",
});

export async function runMigrations(): Promise<void> {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "migrations") });
}
