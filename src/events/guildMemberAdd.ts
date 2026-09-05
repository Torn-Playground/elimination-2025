import { Events, type GuildMember, type TextChannel } from "discord.js";
import { verify } from "../services/verification";

export const name = Events.GuildMemberAdd;

export async function execute(member: GuildMember) {
    const channel = member.guild.channels.cache.find(
        (c) => c.name === "not-verified",
    ) as TextChannel;

    // Helper to send message if channel exists
    const notify = async (msg: string) => {
        if (channel) {
            try {
                await channel.send(msg);
            } catch (e) {
                console.error(`Failed to send message to 'not-verified':`, e);
            }
        } else {
            console.log(`'not-verified' channel not found. Message: ${msg}`);
        }
    };

    console.log(`User joined: ${member.id}, attempting auto-verification...`);
    try {
        const result = await verify(member);
        if (!result.verified) {
            await notify(
                `Welcome <@${member.id}>! Could not automatically verify you. Please verify your Torn account here: [Verify with Torn](https://discordapp.com/api/oauth2/authorize?client_id=441210177971159041&redirect_uri=https%3A%2F%2Fwww.torn.com%2Fdiscord.php&response_type=code&scope=identify) then use \`/v\`.`,
            );
            return;
        }

        const statusLines = [`Verified <@${member.id}> as **${result.nickname}**.`];

        if (!result.renamed) statusLines.push("⚠ Could not update nickname (check permissions).");
        if (!result.appliedVerifiedRole) statusLines.push("⚠ Could not add verified role.");
        if (!result.appliedTeamRole) statusLines.push("⚠ Could not apply team role.");

        await notify(statusLines.join("\n"));
    } catch (error) {
        console.error("Error in guildMemberAdd:", error);
    }
}
