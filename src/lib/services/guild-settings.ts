import { eq } from "drizzle-orm";
import { db } from "../db";
import { guildSettings as table } from "../db/schema";

export type GuildSettings = {
    verifiedRoleId: string | null;
    notVerifiedChannelId: string | null;
    managementChannelId: string | null;
};

const empty: GuildSettings = {
    verifiedRoleId: null,
    notVerifiedChannelId: null,
    managementChannelId: null,
};

export function getGuildSettings(guildId: string): GuildSettings {
    const row = db.select().from(table).where(eq(table.guildId, guildId)).get();
    return row ?? empty;
}

function saveGuildSettings(
    guildId: string,
    fields: Partial<{
        verifiedRoleId: string;
        notVerifiedChannelId: string;
        managementChannelId: string;
    }>,
): void {
    db.insert(table)
        .values({ guildId, ...fields })
        .onConflictDoUpdate({
            target: table.guildId,
            set: fields,
        })
        .run();
}

export function setVerifiedRole(guildId: string, roleId: string): void {
    saveGuildSettings(guildId, { verifiedRoleId: roleId });
}

export function setNotVerifiedChannel(guildId: string, channelId: string): void {
    saveGuildSettings(guildId, { notVerifiedChannelId: channelId });
}

export function setManagementChannel(guildId: string, channelId: string): void {
    saveGuildSettings(guildId, { managementChannelId: channelId });
}
