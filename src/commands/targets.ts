import { container } from "@sapphire/framework";
import { Subcommand } from "@sapphire/plugin-subcommands";
import {
    type AutocompleteInteraction,
    EmbedBuilder,
    type Guild,
    type GuildTextBasedChannel,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { listTrackedTeams } from "../lib/services/activity-chart";
import {
    clearTargetsBoard,
    getGuildSettings,
    setTargetPrimary,
    setTargetSecondary,
    setTargetsLocation,
} from "../lib/services/guild-settings";
import {
    addTargetFarm,
    clearTargetFarms,
    listTargetFarms,
    removeTargetFarm,
} from "../lib/services/target-farms";

const MAX_AUTOCOMPLETE_CHOICES = 25;
const BOARD_COLOR = 0xe74c3c;
const BOARD_TITLE = "Elimination Targets";
const FARMS_FIELD_LIMIT = 1024;

async function fetchTextChannel(
    guild: Guild,
    channelId: string,
): Promise<GuildTextBasedChannel | null> {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) {
        return null;
    }
    return channel as GuildTextBasedChannel;
}

function summarizeBoard(
    primary: string,
    secondary: string | null,
    farms: string[],
    channelId?: string,
    ping = false,
): string {
    const location = channelId ? ` in <#${channelId}>` : "";
    const lines = [`Primary: **${primary}**`];
    if (secondary) {
        lines.push(`Secondary: **${secondary}**`);
    }
    if (farms.length > 0) {
        lines.push(`Farms: ${farms.map((farm) => `**${farm}**`).join(", ")}`);
    }
    if (ping) {
        lines.push("@everyone");
    }
    return `Targets updated${location}:\n${lines.join("\n")}`;
}

export class TargetsCommand extends Subcommand {
    public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
        super(context, {
            ...options,
            name: "targets",
            description: "Configure the elimination targets board",
            preconditions: ["GuildOnly"],
            requiredUserPermissions: ["ManageGuild"],
            subcommands: [
                {
                    name: "set",
                    chatInputRun: "chatInputSet",
                },
                {
                    name: "clear",
                    chatInputRun: "chatInputClear",
                },
                {
                    name: "farm",
                    type: "group",
                    entries: [
                        { name: "add", chatInputRun: "chatInputFarmAdd" },
                        { name: "remove", chatInputRun: "chatInputFarmRemove" },
                        { name: "clear", chatInputRun: "chatInputFarmClear" },
                    ],
                },
            ],
        });
    }

    public override registerApplicationCommands(registry: Subcommand.Registry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName("targets")
                .setDescription("Configure the targets board")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
                .addSubcommand((sub) =>
                    sub
                        .setName("set")
                        .setDescription("Set the primary (and optional secondary) target")
                        .addStringOption((option) =>
                            option
                                .setName("primary")
                                .setDescription("The primary target team")
                                .setRequired(true)
                                .setAutocomplete(true),
                        )
                        .addStringOption((option) =>
                            option
                                .setName("secondary")
                                .setDescription("The secondary target team")
                                .setRequired(false)
                                .setAutocomplete(true),
                        )
                        .addBooleanOption((option) =>
                            option
                                .setName("ping")
                                .setDescription("Ping @everyone when posting the board")
                                .setRequired(false),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName("clear")
                        .setDescription("Clear the targets board and remove its message"),
                )
                .addSubcommandGroup((group) =>
                    group
                        .setName("farm")
                        .setDescription("Manage farm teams")
                        .addSubcommand((sub) =>
                            sub
                                .setName("add")
                                .setDescription("Add a farm team")
                                .addStringOption((option) =>
                                    option
                                        .setName("team")
                                        .setDescription("The farm team")
                                        .setRequired(true)
                                        .setAutocomplete(true),
                                ),
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("remove")
                                .setDescription("Remove a farm team")
                                .addStringOption((option) =>
                                    option
                                        .setName("team")
                                        .setDescription("The farm team")
                                        .setRequired(true)
                                        .setAutocomplete(true),
                                ),
                        )
                        .addSubcommand((sub) =>
                            sub.setName("clear").setDescription("Remove all farm teams"),
                        ),
                ),
        );
    }

    private async defer(interaction: Subcommand.ChatInputCommandInteraction) {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    }

    private requiredGuild(interaction: { guild: Guild | null }): Guild {
        const guild = interaction.guild;
        if (!guild) {
            throw new Error("Targets command was invoked outside of a guild.");
        }
        return guild;
    }

    private buildEmbed(primary: string, secondary: string | null, farms: string[]): EmbedBuilder {
        const fields = [
            { name: "Primary target", value: primary, inline: true },
            ...(secondary ? [{ name: "Secondary target", value: secondary, inline: true }] : []),
            ...(farms.length > 0
                ? [
                      {
                          name: "Farms",
                          value: farms.join("\n").slice(0, FARMS_FIELD_LIMIT),
                          inline: false,
                      },
                  ]
                : []),
        ];
        return new EmbedBuilder()
            .setColor(BOARD_COLOR)
            .setTitle(BOARD_TITLE)
            .setTimestamp()
            .addFields(fields);
    }

    // Delete board messages in the channel except <keepId>. Matches on the embed title rather
    // than the author, so stale copies from earlier sessions/tokens are removed too; deleting
    // someone else's message requires Manage Messages, failures are logged instead of swallowed.
    private async removeBoardCopies(
        channel: GuildTextBasedChannel,
        keepId?: string,
    ): Promise<void> {
        const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
        if (!recent) {
            return;
        }
        const stale = recent.filter(
            (message) =>
                message.id !== keepId &&
                message.embeds.some((embed) => embed.title === BOARD_TITLE),
        );
        for (const message of stale.values()) {
            await message.delete().catch((error) => {
                container.logger.warn(
                    `Failed to delete targets board message ${message.id}: ${error}`,
                );
            });
        }
    }

    private async deleteStoredMessage(
        channel: GuildTextBasedChannel,
        messageId: string,
    ): Promise<void> {
        const message = await channel.messages.fetch(messageId).catch(() => null);
        if (!message) {
            return;
        }
        await message.delete().catch((error) => {
            container.logger.warn(`Failed to delete targets board message ${messageId}: ${error}`);
        });
    }

    private async refreshBoard(
        guild: Guild,
        channelId: string,
        ping = false,
    ): Promise<{ channelId: string; messageId: string } | null> {
        const settings = await getGuildSettings(guild.id);
        const channel = await fetchTextChannel(guild, channelId);
        if (!channel || !settings.targetsPrimary) {
            return null;
        }

        const embed = this.buildEmbed(
            settings.targetsPrimary,
            settings.targetsSecondary,
            await listTargetFarms(guild.id),
        );

        if (settings.targetsMessageId) {
            await this.deleteStoredMessage(channel, settings.targetsMessageId);
        }

        const sent = await channel.send({
            content: ping ? "@everyone" : undefined,
            embeds: [embed],
        });
        await this.removeBoardCopies(channel, sent.id);
        await setTargetsLocation(guild.id, channel.id, sent.id);
        return { channelId: channel.id, messageId: sent.id };
    }

    // ---- /targets set ----

    public async chatInputSet(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guild = this.requiredGuild(interaction);
        const primary = interaction.options.getString("primary", true).trim();
        // Omitted secondary clears the field: /targets set defines the full primary/secondary state.
        const secondary = interaction.options.getString("secondary")?.trim() || null;
        const ping = interaction.options.getBoolean("ping") ?? false;
        if (!primary) {
            await interaction.editReply({ content: "The primary target cannot be empty." });
            return;
        }

        const settings = await getGuildSettings(guild.id);
        const channelId = settings.targetsChannelId;
        if (!channelId) {
            await interaction.editReply({
                content: "No targets channel configured. Set it with `/config channel targets`.",
            });
            return;
        }
        if (!(await fetchTextChannel(guild, channelId))) {
            await interaction.editReply({
                content:
                    "The targets channel is not available anymore. Reconfigure it with `/config channel targets`.",
            });
            return;
        }

        await Promise.all([
            setTargetPrimary(guild.id, primary),
            setTargetSecondary(guild.id, secondary),
        ]);
        const board = await this.refreshBoard(guild, channelId, ping);
        if (!board) {
            await interaction.editReply({
                content: "Could not reach that channel to post the board.",
            });
            return;
        }
        await interaction.editReply({
            content: summarizeBoard(
                primary,
                secondary,
                await listTargetFarms(guild.id),
                board.channelId,
                ping,
            ),
        });
    }

    public async chatInputClear(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guild = this.requiredGuild(interaction);
        const settings = await getGuildSettings(guild.id);

        if (settings.targetsChannelId) {
            const channel = await fetchTextChannel(guild, settings.targetsChannelId);
            if (channel) {
                if (settings.targetsMessageId) {
                    await this.deleteStoredMessage(channel, settings.targetsMessageId);
                }
                // Also sweep recent copies so manually duplicated boards are removed as well.
                await this.removeBoardCopies(channel);
            }
        }

        await Promise.all([clearTargetFarms(guild.id), clearTargetsBoard(guild.id)]);
        await interaction.editReply({ content: "Targets board cleared." });
    }

    // ---- /targets farm ----

    public async chatInputFarmAdd(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guild = this.requiredGuild(interaction);
        const name = interaction.options.getString("team", true).trim();
        if (!name) {
            await interaction.editReply({ content: "The team name cannot be empty." });
            return;
        }
        if (!(await this.ensureBoard(guild, interaction))) {
            return;
        }

        const added = await addTargetFarm(guild.id, name);
        const message = added ? `Added farm **${name}**.` : `**${name}** is already a farm team.`;
        await this.finishFarmChange(guild, interaction, message);
    }

    public async chatInputFarmRemove(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guild = this.requiredGuild(interaction);
        const name = interaction.options.getString("team", true).trim();
        if (!name) {
            await interaction.editReply({ content: "The team name cannot be empty." });
            return;
        }
        if (!(await this.ensureBoard(guild, interaction))) {
            return;
        }

        const removed = await removeTargetFarm(guild.id, name);
        const message = removed
            ? `Removed farm **${name}**.`
            : `**${name}** is not a configured farm team.`;
        await this.finishFarmChange(guild, interaction, message);
    }

    public async chatInputFarmClear(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guild = this.requiredGuild(interaction);
        if (!(await this.ensureBoard(guild, interaction))) {
            return;
        }

        const count = await clearTargetFarms(guild.id);
        const message =
            count === 0 ? "No farm teams were configured." : `Removed all **${count}** farm teams.`;
        await this.finishFarmChange(guild, interaction, message);
    }

    private async ensureBoard(
        guild: Guild,
        interaction: Subcommand.ChatInputCommandInteraction,
    ): Promise<boolean> {
        const settings = await getGuildSettings(guild.id);
        if (!settings.targetsChannelId || !settings.targetsPrimary) {
            await interaction.editReply({
                content:
                    "No targets board yet. Configure the channel with `/config channel targets`, then set it up with `/targets set`.",
            });
            return false;
        }
        return true;
    }

    private async finishFarmChange(
        guild: Guild,
        interaction: Subcommand.ChatInputCommandInteraction,
        detail: string,
    ): Promise<void> {
        const settings = await getGuildSettings(guild.id);
        const channelId = settings.targetsChannelId;
        const board = channelId
            ? await this.refreshBoard(guild, channelId).catch(() => null)
            : null;
        await interaction.editReply({
            content: board
                ? detail
                : `${detail} The board message could not be updated (channel deleted?). Run \`/targets set\` to recreate it.`,
        });
    }

    public override async autocompleteRun(interaction: AutocompleteInteraction) {
        const guildId = interaction.guildId;
        const group = interaction.options.getSubcommandGroup(false);
        const subcommand = interaction.options.getSubcommand(false);
        const focused = interaction.options.getFocused(true);

        let names: string[];
        if (subcommand === "set" && (focused.name === "primary" || focused.name === "secondary")) {
            names = await listTrackedTeams();
        } else if (group === "farm" && subcommand === "add") {
            names = await listTrackedTeams();
        } else if (group === "farm" && subcommand === "remove") {
            names = guildId ? await listTargetFarms(guildId) : [];
        } else {
            await interaction.respond([]);
            return;
        }

        const fragment = String(focused.value).toLowerCase();
        const matches = fragment
            ? names.filter((name) => name.toLowerCase().includes(fragment))
            : names;
        await interaction.respond(
            matches.slice(0, MAX_AUTOCOMPLETE_CHOICES).map((name) => ({ name, value: name })),
        );
    }
}
