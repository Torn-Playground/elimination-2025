import { ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from 'discord.js';
import { verify } from "../services/verification";

export const data = new SlashCommandBuilder()
    .setName('v')
    .setDescription('Verify your Torn account and sync roles.');

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: ["Ephemeral"] });
        return;
    }

    await interaction.deferReply();

    try {
        const member = interaction.member as GuildMember;
        const result = await verify(member)

        if (!result.verified) {
            await interaction.editReply({
                content: 'Could not find a Torn account linked to your Discord ID. Please ensure you have verified with a Torn bot that supports Discord linking, or check your Torn settings.'
            });
            return;
        }

        const statusLines = [`Verified <@${member.id}> as **${result.nickname}**.`];

        if (!result.renamed) statusLines.push('⚠ Could not update nickname (check permissions).');
        if (!result.appliedVerifiedRole) statusLines.push('⚠ Could not add verified role.');
        if (!result.appliedTeamRole) statusLines.push('⚠ Could not apply team role.');

        await interaction.editReply({ content: statusLines.join('\n') });
    } catch (error) {
        console.error('Verify command error:', error);
        await interaction.editReply({ content: 'An error occurred during verification.' });
    }
}
