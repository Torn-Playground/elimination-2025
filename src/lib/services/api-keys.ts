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

export async function listApiKeys(): Promise<ApiKey[]> {
    return await db.select().from(table).orderBy(asc(table.id));
}

export async function countApiKeys(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`count(*)` }).from(table);
    return row?.count ?? 0;
}

export async function findApiKeyByKey(key: string): Promise<ApiKey | null> {
    const [row] = await db.select().from(table).where(eq(table.key, key)).limit(1);
    return row ?? null;
}

export async function addApiKey(apiKey: NewApiKey): Promise<ApiKey> {
    const [header] = await db.insert(table).values(apiKey).execute();
    return { id: header.insertId, ...apiKey, lastUsedAt: null, createdAt: new Date() };
}

export async function removeApiKey(id: number): Promise<boolean> {
    const [header] = await db.delete(table).where(eq(table.id, id)).execute();
    return header.affectedRows > 0;
}

export async function nextApiKey(): Promise<ApiKey | null> {
    const [candidate] = await db
        .select()
        .from(table)
        .orderBy(
            sql`${table.lastUsedAt}
            IS NOT NULL`,
            asc(table.lastUsedAt),
        )
        .limit(1);
    if (!candidate) {
        return null;
    }
    const usedAt = new Date();
    await db.update(table).set({ lastUsedAt: usedAt }).where(eq(table.id, candidate.id));
    return { ...candidate, lastUsedAt: usedAt };
}
