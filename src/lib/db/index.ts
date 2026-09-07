import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { DATABASE_PATH } from "../../config";
import * as schema from "./schema";

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const sqlite = new Database(DATABASE_PATH);
sqlite.run("PRAGMA journal_mode = WAL");
sqlite.run("PRAGMA foreign_keys = ON");

export const db = drizzle(sqlite, { schema });

// ponytail: drizzle types bun-sqlite .run() as void, but bun returns { changes, lastInsertRowid }
export type RunResult = { changes: number; lastInsertRowid: number | bigint };
export function runResult(result: unknown): RunResult {
    return result as RunResult;
}

export function runMigrations(): void {
    migrate(db, { migrationsFolder: path.resolve(process.cwd(), "migrations") });
}
