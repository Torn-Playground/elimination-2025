import { randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { db } from "../db";
import { webSessions } from "../db/schema";

const SESSION_DAYS = 30;
const DAY_MS = 86_400_000;

export type WebUser = {
    id: string;
    username: string;
    avatar: string;
};

export async function createWebSession(user: WebUser): Promise<string> {
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    await db.delete(webSessions).where(lt(webSessions.expiresAt, new Date()));
    await db.insert(webSessions).values({
        token,
        userId: user.id,
        username: user.username,
        avatar: user.avatar,
        expiresAt,
    });
    return token;
}

export async function getWebSession(token: string): Promise<WebUser | null> {
    const [row] = await db.select().from(webSessions).where(eq(webSessions.token, token)).limit(1);
    if (!row) return null;
    if (row.expiresAt.getTime() <= Date.now()) {
        await deleteWebSession(token);
        return null;
    }
    return { id: row.userId, username: row.username, avatar: row.avatar };
}

export async function deleteWebSession(token: string): Promise<void> {
    await db.delete(webSessions).where(eq(webSessions.token, token));
}
