import { eq } from "drizzle-orm";
import { db } from "../db";
import { guildSettings as table } from "../db/schema";

export type GuildSettings = {
    verifiedRoleId: string | null;
    notVerifiedChannelId: string | null;
    managementChannelId: string | null;
    targetsChannelId: string | null;
    targetsMessageId: string | null;
    targetsPrimary: string | null;
    targetsSecondary: string | null;
};

const empty: GuildSettings = {
    verifiedRoleId: null,
    notVerifiedChannelId: null,
    managementChannelId: null,
    targetsChannelId: null,
    targetsMessageId: null,
    targetsPrimary: null,
    targetsSecondary: null,
};

export async function getGuildSettings(guildId: string): Promise<GuildSettings> {
    const [row] = await db.select().from(table).where(eq(table.guildId, guildId)).limit(1);
    return row ?? empty;
}

async function saveGuildSettings(
    guildId: string,
    fields: Partial<{
        verifiedRoleId: string | null;
        notVerifiedChannelId: string | null;
        managementChannelId: string | null;
        targetsChannelId: string | null;
        targetsMessageId: string | null;
        targetsPrimary: string | null;
        targetsSecondary: string | null;
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

export function setTargetsChannel(guildId: string, channelId: string): Promise<void> {
    return saveGuildSettings(guildId, { targetsChannelId: channelId });
}

export function setTargetsLocation(
    guildId: string,
    channelId: string,
    messageId: string,
): Promise<void> {
    return saveGuildSettings(guildId, { targetsChannelId: channelId, targetsMessageId: messageId });
}

export function setTargetPrimary(guildId: string, name: string): Promise<void> {
    return saveGuildSettings(guildId, { targetsPrimary: name });
}

export function setTargetSecondary(guildId: string, name: string | null): Promise<void> {
    return saveGuildSettings(guildId, { targetsSecondary: name });
}

export function clearTargetsBoard(guildId: string): Promise<void> {
    return saveGuildSettings(guildId, {
        targetsPrimary: null,
        targetsSecondary: null,
        targetsMessageId: null,
    });
}
