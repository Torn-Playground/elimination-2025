import { Subcommand } from "@sapphire/plugin-subcommands";
import {
    type AutocompleteInteraction,
    type GuildMember,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { countApiKeys } from "../lib/services/api-keys";
import { getGuildSettings } from "../lib/services/guild-settings";
import { getKnownRoster } from "../lib/services/team-members";
import { findTeamRole, listTeamRoles } from "../lib/services/team-roles";
import { formatSuccessMessage, verify } from "../lib/services/verification";

const PROCESSING_BUDGET_MS = 14 * 60 * 1000;
const MAX_AUTOCOMPLETE_CHOICES = 25;
const MAX_LISTED = 40;
const TORN_ID_PATTERN = /\[(\d+)]\s*$/;

function parseTornId(nickname: string | null): number | null {
    const match = nickname?.match(TORN_ID_PATTERN);
    return match ? Number(match[1]) : null;
}

function listSection(title: string, entries: string[]): string[] {
    if (entries.length === 0) return [];
    const shown = entries.slice(0, MAX_LISTED);
    const more = entries.length - shown.length;
    return [
        title,
        ...shown.map((entry) => `- ${entry}`),
        ...(more > 0 ? [`…and ${more} more`] : []),
    ];
}

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
                { name: "validate", chatInputRun: "chatInputValidate" },
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
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("validate")
                        .setDescription(
                            "Check that holders of a team's mapped role are on its known roster",
                        )
                        .addStringOption((option) =>
                            option
                                .setName("team")
                                .setDescription("The elimination team to check against")
                                .setRequired(true)
                                .setAutocomplete(true),
                        )
                        .addBooleanOption((option) =>
                            option
                                .setName("remove")
                                .setDescription(
                                    "If true, remove the role from members not on the roster",
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

        const keyCount = await countApiKeys();
        if (keyCount === 0) {
            await interaction.editReply({
                content: "No Torn API keys are configured yet.",
            });
            return;
        }

        const verifiedRoleId = (await getGuildSettings(guild.id)).verifiedRoleId;
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

    public async chatInputValidate(interaction: Subcommand.ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const guild = interaction.guild;
        if (!guild) return; // GuildOnly precondition

        const teamName = interaction.options.getString("team", true).trim();
        const mapping = await findTeamRole(guild.id, teamName);
        if (!mapping) {
            await interaction.editReply({
                content: `No role mapped for **${teamName}**. Add one with \`/config team-roles add\`.`,
            });
            return;
        }
        const role = await guild.roles.fetch(mapping.roleId);
        if (!role) {
            await interaction.editReply({
                content: `The mapped role for **${teamName}** no longer exists in this server.`,
            });
            return;
        }

        const roster = await getKnownRoster(teamName);
        if (!roster) {
            await interaction.editReply({
                content: `No tracked team matches **${teamName}**. Try an autocomplete suggestion.`,
            });
            return;
        }

        if (guild.members.cache.size < guild.memberCount) {
            await guild.members.fetch();
        }
        const holders = guild.members.cache.filter(
            (member) => !member.user.bot && member.roles.cache.has(role.id),
        );

        const known = new Set(roster.members.map((member) => member.userId));
        let matchedCount = 0;
        const mismatched: { member: GuildMember; label: string }[] = [];
        const unresolved: string[] = [];

        for (const member of holders.values()) {
            const tornId = parseTornId(member.nickname);
            if (tornId === null) {
                unresolved.push(member.user.username);
            } else if (known.has(tornId)) {
                matchedCount++;
            } else {
                mismatched.push({ member, label: member.nickname ?? member.user.username });
            }
        }

        let removedCount = 0;
        let failedRemovals = 0;
        if (interaction.options.getBoolean("remove") ?? false) {
            const results = await Promise.allSettled(
                mismatched.map(({ member }) => member.roles.remove(role.id)),
            );
            for (const [index, result] of results.entries()) {
                if (result.status === "fulfilled") {
                    removedCount++;
                } else {
                    failedRemovals++;
                    console.warn(
                        `Failed to remove role from ${mismatched[index].member.id}:`,
                        result.reason,
                    );
                }
            }
        }

        const lines = [
            `**Validation: ${role.name} vs ${teamName}**`,
            `Role holders: ${holders.size} (bots excluded)`,
            `Roster size: ${roster.members.length}`,
            `Matched: ${matchedCount}`,
            `Mismatched: ${mismatched.length}`,
            `Unresolved (no Torn ID in nickname): ${unresolved.length}`,
            ...(removedCount > 0 || failedRemovals > 0
                ? [
                      `Roles removed: ${removedCount}${failedRemovals > 0 ? ` (${failedRemovals} failed)` : ""}`,
                  ]
                : []),
            ...listSection(
                `\n❌ Not on **${teamName}**:`,
                mismatched.map((entry) => entry.label),
            ),
            ...listSection("\n⚠ Could not read Torn ID:", unresolved),
        ];
        if (holders.size > 0 && mismatched.length === 0 && unresolved.length === 0) {
            lines.push(`\n✅ All role holders are on **${teamName}**.`);
        }

        await interaction.editReply({ content: lines.join("\n").slice(0, 2000) });
    }

    public override async autocompleteRun(interaction: AutocompleteInteraction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== "team") {
            await interaction.respond([]);
            return;
        }

        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.respond([]);
            return;
        }

        const fragment = String(focused.value).toLowerCase();
        const names = (await listTeamRoles(guildId)).map((entry) => entry.name);
        const matches = fragment
            ? names.filter((name) => name.toLowerCase().includes(fragment))
            : names;
        await interaction.respond(
            matches.slice(0, MAX_AUTOCOMPLETE_CHOICES).map((name) => ({ name, value: name })),
        );
    }
}
