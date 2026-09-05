import { Events, type GuildMember } from "discord.js";
import { NOT_VERIFIED_CHANNEL_NAME, TORN_VERIFY_URL } from "../config";
import { formatSuccessMessage, verify } from "../services/verification";

export const name = Events.GuildMemberAdd;

export async function execute(member: GuildMember) {
    const channel = member.guild.channels.cache.find((c) => c.name === NOT_VERIFIED_CHANNEL_NAME);

    const notify = async (msg: string) => {
        if (!channel?.isTextBased()) {
            console.log(`'${NOT_VERIFIED_CHANNEL_NAME}' channel not found. Message: ${msg}`);
            return;
        }
        try {
            await channel.send(msg);
        } catch (e) {
            console.error(`Failed to send message to '${NOT_VERIFIED_CHANNEL_NAME}':`, e);
        }
    };

    console.log(`User joined: ${member.id}, attempting auto-verification...`);
    try {
        const result = await verify(member);
        if (!result.verified) {
            await notify(
                `Welcome <@${member.id}>! Could not automatically verify you. Please verify your Torn account here: [Verify with Torn](${TORN_VERIFY_URL}) then use \`/v\`.`,
            );
            return;
        }

        await notify(formatSuccessMessage(member.id, result));
    } catch (error) {
        console.error("Error in guildMemberAdd:", error);
    }
}
