import { Subcommand } from "@sapphire/plugin-subcommands";
import { MessageFlags } from "discord.js";
import { OWNER_ID } from "../config";
import {
    addAdminRole,
    clearPushWindow,
    getPushSettings,
    listAdminRoles,
    listSchedule,
    removeAdminRole,
    setPushChannel,
    setPushLead,
    setPushRole,
    setPushWindow,
} from "../lib/services/push";
import { formatUtcWindow } from "../lib/services/push-reminders";

const HOUR_MS = 3_600_000;
const MAX_LEAD_MINUTES = 360;

function isOwner(userId: string): boolean {
    return OWNER_ID !== null && userId === OWNER_ID;
}

function parseHourAligned(raw: string): Date | null {
    const value = raw.trim();
    // Zone-less input is treated as UTC (Discord users rarely append Z).
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
    const date = new Date(hasZone ? value : `${value}Z`);
    if (Number.isNaN(date.getTime())) return null;
    return date.getTime() % HOUR_MS === 0 ? date : null;
}

function formatRange(start: Date, end: Date): string {
    const hours = Math.round((end.getTime() - start.getTime()) / HOUR_MS);
    return `**${start.toISOString().slice(0, 16)} → ${end.toISOString().slice(0, 16)} UTC** (${hours} h)`;
}

export class PushCommand extends Subcommand {
    public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
        super(context, {
            ...options,
            name: "push",
            description: "Configure the push calendar (owner only)",
            subcommands: [
                { name: "window", chatInputRun: "chatInputWindow" },
                { name: "clear", chatInputRun: "chatInputClear" },
                { name: "channel", chatInputRun: "chatInputChannel" },
                { name: "role", chatInputRun: "chatInputRole" },
                { name: "lead", chatInputRun: "chatInputLead" },
                {
                    name: "admin",
                    type: "group",
                    entries: [
                        { name: "add", chatInputRun: "chatInputAdminAdd" },
                        { name: "remove", chatInputRun: "chatInputAdminRemove" },
                        { name: "list", chatInputRun: "chatInputAdminList" },
                    ],
                },
                { name: "status", chatInputRun: "chatInputStatus" },
            ],
        });
    }

    public override registerApplicationCommands(registry: Subcommand.Registry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName("push")
                .setDescription("Configure the push calendar (owner only)")
                .addSubcommand((sub) =>
                    sub
                        .setName("window")
                        .setDescription("Set the push window (clears all assigned slots)")
                        .addStringOption((option) =>
                            option
                                .setName("start")
                                .setDescription(
                                    "Start, e.g. 2026-09-10T12:00 (UTC, top of the hour)",
                                )
                                .setRequired(true),
                        )
                        .addStringOption((option) =>
                            option
                                .setName("end")
                                .setDescription("End, e.g. 2026-09-18T12:00 (UTC, top of the hour)")
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub.setName("clear").setDescription("Clear the push window"),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("channel")
                        .setDescription("Set the channel where reminders are posted")
                        .addChannelOption((option) =>
                            option
                                .setName("channel")
                                .setDescription("The reminder channel")
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("role")
                        .setDescription("Set the role pinged for unclaimed windows")
                        .addRoleOption((option) =>
                            option
                                .setName("role")
                                .setDescription("The role to ping")
                                .setRequired(true),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("lead")
                        .setDescription("Minutes before a window to send reminders")
                        .addIntegerOption((option) =>
                            option
                                .setName("minutes")
                                .setDescription(
                                    `Reminder lead time in minutes (1–${MAX_LEAD_MINUTES})`,
                                )
                                .setMinValue(1)
                                .setMaxValue(MAX_LEAD_MINUTES)
                                .setRequired(true),
                        ),
                )
                .addSubcommandGroup((group) =>
                    group
                        .setName("admin")
                        .setDescription(
                            "Roles allowed to unassign any slot (owner is always allowed)",
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("add")
                                .setDescription("Grant a role unassign rights")
                                .addRoleOption((option) =>
                                    option
                                        .setName("role")
                                        .setDescription("The role to grant")
                                        .setRequired(true),
                                ),
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("remove")
                                .setDescription("Revoke unassign rights from a role")
                                .addRoleOption((option) =>
                                    option
                                        .setName("role")
                                        .setDescription("The role to revoke")
                                        .setRequired(true),
                                ),
                        )
                        .addSubcommand((sub) =>
                            sub.setName("list").setDescription("List admin roles"),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("status")
                        .setDescription("Show the current push calendar configuration"),
                ),
        );
    }

    private async requireOwner(
        interaction: Subcommand.ChatInputCommandInteraction,
    ): Promise<boolean> {
        if (!isOwner(interaction.user.id)) {
            await interaction.reply({
                content: "Only the bot owner can use `/push`.",
                flags: [MessageFlags.Ephemeral],
            });
            return false;
        }
        return true;
    }

    private canSendMessages(channel: { id: string; isTextBased?: () => boolean }): boolean {
        return typeof channel.isTextBased === "function" && channel.isTextBased();
    }

    // ---- /push window ----

    public async chatInputWindow(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const rawStart = interaction.options.getString("start", true).trim();
        const rawEnd = interaction.options.getString("end", true).trim();
        const start = parseHourAligned(rawStart);
        const end = parseHourAligned(rawEnd);
        if (!start || !end) {
            await interaction.editReply({
                content:
                    "Dates must parse and sit on a whole hour, e.g. `2026-09-10T12:00` and `2026-09-18T12:00` (UTC).",
            });
            return;
        }
        if (end.getTime() <= start.getTime()) {
            await interaction.editReply({ content: "The window end must be after its start." });
            return;
        }

        await setPushWindow(start, end);
        await interaction.editReply({
            content: `Push window set to ${formatRange(start, end)}. Previous slots were cleared.`,
        });
    }

    public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        await clearPushWindow();
        await interaction.editReply({ content: "Push window cleared." });
    }

    // ---- /push channel ----

    public async chatInputChannel(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const guild = interaction.guild;
        if (!guild) {
            await interaction.editReply({
                content: "Run this in the server where reminders are sent.",
            });
            return;
        }
        const channel = interaction.options.getChannel("channel", true);
        if (!this.canSendMessages(channel)) {
            await interaction.editReply({ content: "That must be a text channel." });
            return;
        }
        await setPushChannel(guild.id, channel.id);
        await interaction.editReply({
            content: `Push reminder channel set to <#${channel.id}>. Calendar membership is now restricted to ${guild.name} members.`,
        });
    }

    // ---- /push role ----

    public async chatInputRole(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const role = interaction.options.getRole("role", true);
        await setPushRole(role.id);
        await interaction.editReply({
            content: `Role pinged for unclaimed windows set to <@&${role.id}>.`,
        });
    }

    // ---- /push lead ----

    public async chatInputLead(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const minutes = interaction.options.getInteger("minutes", true);
        await setPushLead(minutes);
        await interaction.editReply({
            content: `Reminder lead time set to ${minutes} minute${minutes === 1 ? "" : "s"}.`,
        });
    }

    // ---- /push admin ----

    public async chatInputAdminAdd(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const role = interaction.options.getRole("role", true);
        if (!(await addAdminRole(role.id))) {
            await interaction.editReply({ content: `<@&${role.id}> already has unassign rights.` });
            return;
        }
        await interaction.editReply({ content: `<@&${role.id}> can now unassign any slot.` });
    }

    public async chatInputAdminRemove(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const role = interaction.options.getRole("role", true);
        if (!(await removeAdminRole(role.id))) {
            await interaction.editReply({ content: `<@&${role.id}> has no unassign rights.` });
            return;
        }
        await interaction.editReply({ content: `Revoked unassign rights from <@&${role.id}>.` });
    }

    public async chatInputAdminList(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        const roles = await listAdminRoles();
        const lines = roles.map((id) => `<@&${id}>`);
        await interaction.editReply({
            content:
                lines.length === 0
                    ? "No admin roles configured (the owner is always allowed)."
                    : `Roles with unassign rights:\n${lines.join("\n")}`,
        });
    }

    // ---- /push status ----

    public async chatInputStatus(interaction: Subcommand.ChatInputCommandInteraction) {
        if (!(await this.requireOwner(interaction))) return;
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const settings = await getPushSettings();
        const lines = [
            `**Window:** ${settings.start && settings.end ? formatRange(settings.start, settings.end) : "not set"}`,
            `**Channel:** ${settings.channelId ? `<#${settings.channelId}>` : "not set"}`,
            `**Role:** ${settings.roleId ? `<@&${settings.roleId}>` : "not set"}`,
            `**Lead:** ${settings.leadMinutes} minute${settings.leadMinutes === 1 ? "" : "s"}`,
            `**Admin roles:** ${
                settings.adminRoleIds.length > 0
                    ? settings.adminRoleIds.map((id) => `<@&${id}>`).join(", ")
                    : "none"
            }`,
        ];

        if (settings.start && settings.end) {
            const schedule = await listSchedule();
            const total = schedule.length;
            const claimed = schedule.filter((entry) => entry.userId !== null).length;
            const pct = total === 0 ? 0 : Math.round((claimed / total) * 1000) / 10;
            lines.push(
                `**Coverage:** ${claimed}/${total} h (${pct}%)`,
                `**Claimed slots:**\n${
                    schedule
                        .filter((entry) => entry.userId !== null)
                        .map((entry) => `${formatUtcWindow(entry.start)} — <@${entry.userId}>`)
                        .join("\n") || "none"
                }`,
            );
        }

        await interaction.editReply({ content: lines.join("\n") });
    }
}
