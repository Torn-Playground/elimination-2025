import { Subcommand } from "@sapphire/plugin-subcommands";
import { type GuildMember, PermissionFlagsBits } from "discord.js";
import { countApiKeys } from "../lib/services/api-keys";
import { getGuildSettings } from "../lib/services/guild-settings";
import { formatSuccessMessage, verify } from "../lib/services/verification";

const PROCESSING_BUDGET_MS = 14 * 60 * 1000;

export class VerifyCommand extends Subcommand {
    public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
        super(context, {
            ...options,
            name: "verify",
            description: "Verification commands",
            preconditions: ["GuildOnly"],
            requiredUserPermissions: ["ManageRoles"],
            subcommands: [
                { name: "member", chatInputRun: "chatInputMember" },
                { name: "all", chatInputRun: "chatInputAll" },
            ],
        });
    }

    public override registerApplicationCommands(registry: Subcommand.Registry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName("verify")
                .setDescription("Verification commands")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
                .addSubcommand((sub) =>
                    sub
                        .setName("member")
                        .setDescription("Verify a specific member by their Discord account")
                        .addUserOption((option) =>
                            option
                                .setName("target")
                                .setDescription("The user to verify")
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
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
                ),
        );
    }

    public async chatInputMember(interaction: Subcommand.ChatInputCommandInteraction) {
        await interaction.deferReply();
        const guild = interaction.guild;
        if (!guild) return; // GuildOnly precondition

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

    public async chatInputAll(interaction: Subcommand.ChatInputCommandInteraction) {
        await interaction.deferReply();
        const guild = interaction.guild;
        if (!guild) return;

        const keyCount = countApiKeys();
        if (keyCount === 0) {
            await interaction.editReply({
                content: "No Torn API keys are configured yet.",
            });
            return;
        }

        const verifiedRoleId = getGuildSettings(guild.id).verifiedRoleId;
        if (!verifiedRoleId) {
            await interaction.editReply({
                content: "No verified role is configured.",
            });
            return;
        }

        await guild.members.fetch();

        const force = interaction.options.getBoolean("force") ?? false;

        const membersToVerify = guild.members.cache.filter((member) => {
            if (member.user.bot) return false;

            return force || !member.roles.cache.has(verifiedRoleId);
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

        const reportProgress = async (content: string): Promise<boolean> => {
            try {
                await interaction.editReply({ content });
                return true;
            } catch (error) {
                console.error("Bulk verification interrupted (interaction expired?):", error);
                return false;
            }
        };

        const delayMs = Math.max(150, Math.ceil(700 / keyCount));
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

            if (processedCount % 10 === 0 || processedCount === membersToVerify.size) {
                if (
                    !(await reportProgress(
                        `Processing: ${processedCount}/${membersToVerify.size}\nVerified: ${successCount}\nFailed/Unlinked: ${failCount}`,
                    ))
                ) {
                    break;
                }
            }

            await new Promise((resolve) => setTimeout(resolve, delayMs));
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
}
