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
): string {
    const location = channelId ? ` in <#${channelId}>` : "";
    const lines = [`Primary: **${primary}**`];
    if (secondary) {
        lines.push(`Secondary: **${secondary}**`);
    }
    if (farms.length > 0) {
        lines.push(`Farms: ${farms.map((farm) => `**${farm}**`).join(", ")}`);
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
                        ),
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

    // The GuildOnly precondition guarantees a guild context; kept as an explicit boundary check.
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
            .setTitle("Elimination Targets")
            .setTimestamp()
            .addFields(fields);
    }

    // Re-render the board embed in <channelId>: remove the previous board message (if any) and
    // post a fresh one, keeping the board at the newest message position.
    private async refreshBoard(
        guild: Guild,
        channelId: string,
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
            const existing = await channel.messages
                .fetch(settings.targetsMessageId)
                .catch(() => null);
            if (existing && existing.author.id === container.client.user?.id) {
                await existing.delete().catch(() => {});
            }
        }

        const sent = await channel.send({ embeds: [embed] });
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
        const board = await this.refreshBoard(guild, channelId);
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
            ),
        });
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

    // A farm mutation can only apply once the board (channel + primary target) exists.
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

    // Re-render the board after a farm mutation, then confirm (or report the board is unreachable).
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

    // ---- autocomplete ----

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
