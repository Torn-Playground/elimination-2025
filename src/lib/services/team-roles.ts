import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { teamRoles as table } from "../db/schema";

export type TeamRole = {
    guildId: string;
    name: string;
    roleId: string;
};

export async function listTeamRoles(guildId: string): Promise<TeamRole[]> {
    return await db.select().from(table).where(eq(table.guildId, guildId));
}

export async function addTeamRole(guildId: string, name: string, roleId: string): Promise<boolean> {
    // INSERT IGNORE: a duplicate (guild_id, name) yields affectedRows 0.
    const [header] = await db.insert(table).ignore().values({ guildId, name, roleId }).execute();
    return header.affectedRows > 0;
}

export async function removeTeamRole(guildId: string, name: string): Promise<boolean> {
    const [header] = await db
        .delete(table)
        .where(and(eq(table.guildId, guildId), eq(table.name, name)))
        .execute();
    return header.affectedRows > 0;
}

// Exact match first, then case-insensitive (team names from Torn can drift in casing).
export async function findTeamRole(guildId: string, teamName: string): Promise<TeamRole | null> {
    const roles = await listTeamRoles(guildId);
    return (
        roles.find((role) => role.name === teamName) ??
        roles.find((role) => role.name.toLowerCase() === teamName.toLowerCase()) ??
        null
    );
}
