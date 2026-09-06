import { container } from "@sapphire/framework";
import type { Guild } from "discord.js";
import { getGuildSettings } from "../services/guild-settings";

export async function sendStaffLog(guild: Guild, message: string): Promise<void> {
    const { managementChannelId } = getGuildSettings(guild.id);
    const channel = managementChannelId
        ? await guild.channels.fetch(managementChannelId).catch(() => null)
        : null;

    if (!channel?.isTextBased()) {
        container.logger.info(`[${guild.name}] ${message}`);
        return;
    }

    try {
        await channel.send(message);
    } catch (error) {
        container.logger.error(`Failed to send staff log in '${guild.name}':`, error);
    }
}
