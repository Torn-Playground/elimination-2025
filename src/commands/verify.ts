import {
    type ChatInputCommandInteraction,
    type Guild,
    type GuildMember,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from "discord.js";
import { VERIFIED_ROLE_NAME } from "../config";
import { formatSuccessMessage, verify } from "../services/verification";

// Stop before Discord kills the deferred interaction (15 min cap).
const PROCESSING_BUDGET_MS = 14 * 60 * 1000;

export const data = new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Verification commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles) // Restrict to mods/admins by default
    .addSubcommand((subcommand) =>
        subcommand
            .setName("member")
            .setDescription("Verify a specific member by their Discord account")
            .addUserOption((option) =>
                option.setName("target").setDescription("The user to verify").setRequired(true),
            ),
    )
    .addSubcommand((subcommand) =>
        subcommand
            .setName("all")
            .setDescription("Verify all members who are not yet verified")
            .addBooleanOption((option) =>
                option
                    .setName("force")
                    .setDescription(
                        "If true, verifies ALL members regardless of current verified status",
                    )
                    .setRequired(false),
            ),
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
        await interaction.reply({ content: "This command can only be used in a server." });
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "member") {
        await handleVerifyMember(interaction, guild);
    } else if (subcommand === "all") {
        await handleVerifyAll(interaction, guild);
    } else {
        await interaction.reply({ content: "Unknown subcommand." });
    }
}

async function handleVerifyMember(interaction: ChatInputCommandInteraction, guild: Guild) {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser("target", true);
    let targetMember: GuildMember;

    try {
        targetMember = await guild.members.fetch(targetUser.id);
    } catch {
        await interaction.editReply({ content: "Could not find that member in this server." });
        return;
    }

    try {
        const result = await verify(targetMember);

        if (!result.verified) {
            await interaction.editReply({
                content: `Could not find a Torn account linked to <@${targetUser.id}>. They need to be verified with a Torn bot that supports Discord linking.`,
            });
            return;
        }

        await interaction.editReply({ content: formatSuccessMessage(targetUser.id, result) });
    } catch (error) {
        console.error("Verify member error:", error);
        await interaction.editReply({ content: "An error occurred during verification." });
    }
}

async function handleVerifyAll(interaction: ChatInputCommandInteraction, guild: Guild) {
    await interaction.deferReply();

    // 1. Fetch all members (ensure cache is full)
    await guild.members.fetch();

    const force = interaction.options.getBoolean("force") ?? false;

    // 2. Filter unverified (or all if force is true)
    const verifiedRole = guild.roles.cache.find((r) => r.name === VERIFIED_ROLE_NAME);
    if (!verifiedRole) {
        await interaction.editReply({
            content: `Could not find a role named "${VERIFIED_ROLE_NAME}". Please create it first.`,
        });
        return;
    }

    const membersToVerify = guild.members.cache.filter((m) => {
        if (m.user.bot) return false;
        if (force) return true; // Verify everyone if forced
        return !m.roles.cache.has(verifiedRole.id); // Otherwise only unverified
    });

    if (membersToVerify.size === 0) {
        await interaction.editReply({ content: "All eligible members are already verified!" });
        return;
    }

    await interaction.editReply({
        content: `Found ${membersToVerify.size} members to verify. Starting verification process... (This may take a while due to API limits)`,
    });

    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;
    const startedAt = Date.now();
    let stoppedEarly = false;

    // Report progress; if the interaction died (edit fails), signal caller to bail.
    const reportProgress = async (content: string): Promise<boolean> => {
        try {
            await interaction.editReply({ content });
            return true;
        } catch (error) {
            console.error("Bulk verification interrupted (interaction expired?):", error);
            return false;
        }
    };

    // 3. Process with rate limiting
    // Torn API limit is often 100/min. Let's aim safely for 1 request every 1.5 seconds (~40/min) to be safe with other bot usage.
    // Or closer to limit: 1 request every 0.7 seconds (~85/min).
    // Let's go with 1s delay.
    for (const [, member] of membersToVerify) {
        if (Date.now() - startedAt > PROCESSING_BUDGET_MS) {
            stoppedEarly = true;
            break;
        }

        try {
            const result = await verify(member);
            if (result.verified) {
                successCount++;
            } else {
                failCount++;
            }
        } catch {
            failCount++;
        }

        processedCount++;

        // Update progress every 10 members or last one
        if (processedCount % 10 === 0 || processedCount === membersToVerify.size) {
            if (
                !(await reportProgress(
                    `Processing: ${processedCount}/${membersToVerify.size}\nVerified: ${successCount}\nFailed/Unlinked: ${failCount}`,
                ))
            ) {
                break;
            }
        }

        // Wait 1 second
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const summaryLines = [
        stoppedEarly
            ? `**Verification Interrupted** - hit the 14-minute processing limit with ${membersToVerify.size - processedCount} members left. Run this command again to continue.`
            : "**Verification Complete**",
        `Total Processed: ${processedCount}`,
        `Successfully Verified: ${successCount}`,
        `Failed/Unlinked: ${failCount}`,
    ];

    try {
        await interaction.followUp({ content: summaryLines.join("\n") });
    } catch (error) {
        console.error("Failed to send verification summary:", error);
    }
}
