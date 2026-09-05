import { type ChatInputCommandInteraction, GuildMember, SlashCommandBuilder } from "discord.js";
import { TORN_VERIFY_URL } from "../config";
import { formatSuccessMessage, verify } from "../services/verification";

export const data = new SlashCommandBuilder()
    .setName("v")
    .setDescription("Verify your Torn account and sync roles.");

export async function execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({
            content: "This command can only be used in a server.",
            flags: ["Ephemeral"],
        });
        return;
    }

    await interaction.deferReply();

    try {
        const member =
            interaction.member instanceof GuildMember
                ? interaction.member
                : await guild.members.fetch(interaction.user.id);
        const result = await verify(member);

        if (!result.verified) {
            await interaction.editReply({
                content: `Could not find a Torn account linked to your Discord ID. Please verify your Torn account here: [Verify with Torn](${TORN_VERIFY_URL}) then try again.`,
            });
            return;
        }

        await interaction.editReply({ content: formatSuccessMessage(member.id, result) });
    } catch (error) {
        console.error("Verify command error:", error);
        await interaction.editReply({ content: "An error occurred during verification." });
    }
}
