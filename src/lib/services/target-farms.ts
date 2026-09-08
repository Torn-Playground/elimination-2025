import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { targetFarms as table } from "../db/schema";

export async function listTargetFarms(guildId: string): Promise<string[]> {
    const rows = await db
        .select({ name: table.name })
        .from(table)
        .where(eq(table.guildId, guildId))
        .orderBy(asc(table.name));
    return rows.map((row) => row.name);
}

export async function addTargetFarm(guildId: string, name: string): Promise<boolean> {
    const [header] = await db.insert(table).ignore().values({ guildId, name }).execute();
    return header.affectedRows > 0;
}

export async function removeTargetFarm(guildId: string, name: string): Promise<boolean> {
    const [header] = await db
        .delete(table)
        .where(and(eq(table.guildId, guildId), eq(table.name, name)))
        .execute();
    return header.affectedRows > 0;
}

export async function clearTargetFarms(guildId: string): Promise<number> {
    const [header] = await db.delete(table).where(eq(table.guildId, guildId)).execute();
    return header.affectedRows;
}
