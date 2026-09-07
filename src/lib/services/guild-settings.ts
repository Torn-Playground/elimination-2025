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

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
    const [row] = await db.select().from(table).where(eq(table.guildId, guildId)).limit(1);
    return row ?? empty;
}

async function saveGuildSettings(
    guildId: string,
    fields: Partial<{
        verifiedRoleId: string;
        notVerifiedChannelId: string;
        managementChannelId: string;
    }>,
): Promise<void> {
    await db
        .insert(table)
        .values({ guildId, ...fields })
        .onDuplicateKeyUpdate({ set: fields });
}

export function setVerifiedRole(guildId: string, roleId: string): Promise<void> {
    return saveGuildSettings(guildId, { verifiedRoleId: roleId });
}

export function setNotVerifiedChannel(guildId: string, channelId: string): Promise<void> {
    return saveGuildSettings(guildId, { notVerifiedChannelId: channelId });
}

export function setManagementChannel(guildId: string, channelId: string): Promise<void> {
    return saveGuildSettings(guildId, { managementChannelId: channelId });
}
