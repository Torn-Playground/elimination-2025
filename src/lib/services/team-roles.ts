import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { teamRoles as table } from "../db/schema";

export type TeamRole = {
    guildId: string;
    name: string;
    roleId: string;
};

export function listTeamRoles(guildId: string): TeamRole[] {
    return db.select().from(table).where(eq(table.guildId, guildId)).all();
}

export function addTeamRole(guildId: string, name: string, roleId: string): boolean {
    const result = db.insert(table).values({ guildId, name, roleId }).onConflictDoNothing().run();
    return result.changes > 0;
}

export function removeTeamRole(guildId: string, name: string): boolean {
    const result = db
        .delete(table)
        .where(and(eq(table.guildId, guildId), eq(table.name, name)))
        .run();
    return result.changes > 0;
}

// Exact match first, then case-insensitive (team names from Torn can drift in casing).
export function findTeamRole(guildId: string, teamName: string): TeamRole | null {
    const roles = listTeamRoles(guildId);
    return (
        roles.find((role) => role.name === teamName) ??
        roles.find((role) => role.name.toLowerCase() === teamName.toLowerCase()) ??
        null
    );
}
