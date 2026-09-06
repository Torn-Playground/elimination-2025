import { Listener } from "@sapphire/framework";
import { Events, type GuildMember } from "discord.js";
import { TORN_VERIFY_URL } from "../config";
import { getGuildSettings } from "../lib/services/guild-settings";
import { formatSuccessMessage, verify } from "../lib/services/verification";
import { sendStaffLog } from "../lib/util/staff-log";

export class GuildMemberAdd extends Listener<typeof Events.GuildMemberAdd> {
    public constructor(context: Listener.LoaderContext) {
        super(context, { event: Events.GuildMemberAdd });
    }

    public override async run(member: GuildMember) {
        if (member.user.bot) return;

        const guildId = member.guild.id;
        const channelId = getGuildSettings(guildId).notVerifiedChannelId;
        const channel = channelId
            ? await member.guild.channels.fetch(channelId).catch(() => null)
            : null;
        const notify = async (message: string): Promise<void> => {
            if (!channel?.isTextBased()) {
                await sendStaffLog(
                    member.guild,
                    `'not-verified' channel unset/missing; message: ${message}`,
                );
                return;
            }
            try {
                await channel.send(message);
            } catch (error) {
                await sendStaffLog(
                    member.guild,
                    `Failed to message the 'not-verified' channel: ${error}`,
                );
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
            await sendStaffLog(member.guild, `Error auto-verifying <@${member.id}>: ${error}`);
        }
    }
}
