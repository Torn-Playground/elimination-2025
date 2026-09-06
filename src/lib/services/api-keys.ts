import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { apiKeys as table } from "../db/schema";

export type ApiKey = {
    id: number;
    key: string;
    playerId: number;
    playerName: string;
    lastUsedAt: Date | null;
    createdAt: Date;
};

export type NewApiKey = {
    key: string;
    playerId: number;
    playerName: string;
};

export function listApiKeys(): ApiKey[] {
    return db.select().from(table).orderBy(asc(table.id)).all();
}

export function countApiKeys(): number {
    const row = db.select({ count: sql<number>`count(*)` }).from(table).get();
    return row?.count ?? 0;
}

export function findApiKeyByKey(key: string): ApiKey | null {
    return db.select().from(table).where(eq(table.key, key)).get() ?? null;
}

export function addApiKey(apiKey: NewApiKey): ApiKey {
    return db.insert(table).values(apiKey).returning().get();
}

export function removeApiKey(id: number): boolean {
    return db.delete(table).where(eq(table.id, id)).run().changes > 0;
}

export function nextApiKey(): ApiKey | null {
    const candidate = db
        .select()
        .from(table)
        .orderBy(
            sql`${table.lastUsedAt}
            IS NOT NULL`,
            asc(table.lastUsedAt),
        )
        .limit(1)
        .get();
    if (!candidate) {
        return null;
    }
    const usedAt = new Date();
    db.update(table).set({ lastUsedAt: usedAt }).where(eq(table.id, candidate.id)).run();
    return { ...candidate, lastUsedAt: usedAt };
}
