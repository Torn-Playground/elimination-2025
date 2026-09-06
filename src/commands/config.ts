import { Subcommand } from "@sapphire/plugin-subcommands";
import {
    type AutocompleteInteraction,
    type Guild,
    MessageFlags,
    PermissionFlagsBits,
} from "discord.js";
import { addApiKey, findApiKeyByKey, listApiKeys, removeApiKey } from "../lib/services/api-keys";
import {
    setManagementChannel,
    setNotVerifiedChannel,
    setVerifiedRole,
} from "../lib/services/guild-settings";
import { addTeamRole, listTeamRoles, removeTeamRole } from "../lib/services/team-roles";
import { verifyApiKey } from "../lib/services/torn";
import { sendStaffLog } from "../lib/util/staff-log";

const MAX_AUTOCOMPLETE_CHOICES = 25;

function canSendMessages(channel: { id: string; isTextBased?: () => boolean }): boolean {
    return typeof channel.isTextBased === "function" && channel.isTextBased();
}

function maskKey(key: string): string {
    return key.length > 8 ? `${key.slice(0, 3)}••••${key.slice(-4)}` : "••••••••";
}

export class ConfigCommand extends Subcommand {
    public constructor(context: Subcommand.LoaderContext, options: Subcommand.Options) {
        super(context, {
            ...options,
            name: "config",
            description: "Server configuration for the elimination bot",
            preconditions: ["GuildOnly"],
            requiredUserPermissions: ["ManageRoles"],
            subcommands: [
                {
                    name: "api",
                    type: "group",
                    entries: [
                        { name: "list", chatInputRun: "chatInputApiList" },
                        { name: "add", chatInputRun: "chatInputApiAdd" },
                        { name: "remove", chatInputRun: "chatInputApiRemove" },
                    ],
                },
                {
                    name: "team-roles",
                    type: "group",
                    entries: [
                        { name: "list", chatInputRun: "chatInputTeamRolesList" },
                        { name: "add", chatInputRun: "chatInputTeamRolesAdd" },
                        { name: "remove", chatInputRun: "chatInputTeamRolesRemove" },
                    ],
                },
                {
                    name: "role",
                    type: "group",
                    entries: [{ name: "verified", chatInputRun: "chatInputRoleVerified" }],
                },
                {
                    name: "channel",
                    type: "group",
                    entries: [
                        { name: "not-verified", chatInputRun: "chatInputChannelNotVerified" },
                        { name: "management", chatInputRun: "chatInputChannelManagement" },
                    ],
                },
            ],
        });
    }

    public override registerApplicationCommands(registry: Subcommand.Registry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName("config")
                .setDescription("Server configuration for the elimination bot")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
                .addSubcommandGroup((group) =>
                    group
                        .setName("api")
                        .setDescription("Configure Torn API keys")
                        .addSubcommand((sub) =>
                            sub.setName("list").setDescription("List configured API keys"),
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("add")
                                .setDescription("Add and verify a Torn API key")
                                .addStringOption((option) =>
                                    option
                                        .setName("key")
                                        .setDescription("The Torn API key")
                                        .setRequired(true),
                                ),
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("remove")
                                .setDescription(
                                    "Remove an API key by its id (see /config api list)",
                                )
                                .addIntegerOption((option) =>
                                    option
                                        .setName("id")
                                        .setDescription("The key id")
                                        .setRequired(true),
                                ),
                        ),
                )
                .addSubcommandGroup((group) =>
                    group
                        .setName("team-roles")
                        .setDescription("Map elimination team names to roles")
                        .addSubcommand((sub) =>
                            sub.setName("list").setDescription("List team role mappings"),
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("add")
                                .setDescription("Map a team name to a role")
                                .addStringOption((option) =>
                                    option
                                        .setName("name")
                                        .setDescription("The team name")
                                        .setRequired(true),
                                )
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
                                .setDescription("Remove a team role mapping")
                                .addStringOption((option) =>
                                    option
                                        .setName("name")
                                        .setDescription("The team name")
                                        .setRequired(true)
                                        .setAutocomplete(true),
                                ),
                        ),
                )
                .addSubcommandGroup((group) =>
                    group
                        .setName("role")
                        .setDescription("Configure roles")
                        .addSubcommand((sub) =>
                            sub
                                .setName("verified")
                                .setDescription("Set the role granted to verified members")
                                .addRoleOption((option) =>
                                    option
                                        .setName("role")
                                        .setDescription("The verified role")
                                        .setRequired(true),
                                ),
                        ),
                )
                .addSubcommandGroup((group) =>
                    group
                        .setName("channel")
                        .setDescription("Configure channels")
                        .addSubcommand((sub) =>
                            sub
                                .setName("not-verified")
                                .setDescription(
                                    "Set the channel where unverified members are welcomed",
                                )
                                .addChannelOption((option) =>
                                    option
                                        .setName("channel")
                                        .setDescription("The not-verified channel")
                                        .setRequired(true),
                                ),
                        )
                        .addSubcommand((sub) =>
                            sub
                                .setName("management")
                                .setDescription("Set the channel for staff logs")
                                .addChannelOption((option) =>
                                    option
                                        .setName("channel")
                                        .setDescription("The management channel")
                                        .setRequired(true),
                                ),
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
            throw new Error("Config command was invoked outside of a guild.");
        }
        return guild;
    }

    // ---- /config api ----

    public async chatInputApiList(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const keys = listApiKeys();
        if (keys.length === 0) {
            await interaction.editReply({
                content: "No API keys configured yet. Add one with `/config api add`.",
            });
            return;
        }
        const lines = keys.map((key) => {
            const owner = `${key.playerName} [${key.playerId}]`;
            return `\`#${key.id}\` ${owner} — ${maskKey(key.key)}`;
        });
        await interaction.editReply({
            content: `Configured API keys:\n${lines.join("\n")}`,
        });
    }

    public async chatInputApiAdd(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const key = interaction.options.getString("key", true).trim();
        if (!key) {
            await interaction.editReply({ content: "The key cannot be empty." });
            return;
        }

        const verification = await verifyApiKey(key);
        if (!verification.success) {
            await interaction.editReply({ content: verification.message });
            return;
        }

        if (findApiKeyByKey(key)) {
            await interaction.editReply({ content: "That API key is already configured." });
            return;
        }

        const { owner } = verification;
        const stored = addApiKey({ key, ...owner });

        await interaction.editReply({
            content: `Verified and added API key \`#${stored.id}\` for **${owner.playerName}** [${owner.playerId}].`,
        });
    }

    public async chatInputApiRemove(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const id = interaction.options.getInteger("id", true);
        if (!removeApiKey(id)) {
            await interaction.editReply({ content: `No API key with id \`#${id}\`.` });
            return;
        }
        await sendStaffLog(
            this.requiredGuild(interaction),
            `API key \`#${id}\` removed by <@${interaction.user.id}>.`,
        );
        await interaction.editReply({ content: `Removed API key \`#${id}\`.` });
    }

    // ---- /config team-roles ----

    public async chatInputTeamRolesList(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const roles = listTeamRoles(this.requiredGuild(interaction).id);
        if (roles.length === 0) {
            await interaction.editReply({ content: "No team roles mapped yet." });
            return;
        }
        const lines = roles.map((role) => `**${role.name}** → <@&${role.roleId}>`);
        await interaction.editReply({ content: `Team roles:\n${lines.join("\n")}` });
    }

    public async chatInputTeamRolesAdd(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guildId = this.requiredGuild(interaction).id;
        const name = interaction.options.getString("name", true).trim();
        const role = interaction.options.getRole("role", true);

        if (!name) {
            await interaction.editReply({ content: "The team name cannot be empty." });
            return;
        }
        if (!addTeamRole(guildId, name, role.id)) {
            await interaction.editReply({ content: `A role for **${name}** is already mapped.` });
            return;
        }
        await sendStaffLog(
            this.requiredGuild(interaction),
            `Team role **${name}** → <@&${role.id}> added by <@${interaction.user.id}>.`,
        );
        await interaction.editReply({
            content: `Mapped **${name}** → <@&${role.id}> for verified members.`,
        });
    }

    public async chatInputTeamRolesRemove(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const guildId = this.requiredGuild(interaction).id;
        const name = interaction.options.getString("name", true).trim();
        if (!removeTeamRole(guildId, name)) {
            await interaction.editReply({ content: `No mapping for **${name}**.` });
            return;
        }
        await sendStaffLog(
            this.requiredGuild(interaction),
            `Team role **${name}** removed by <@${interaction.user.id}>.`,
        );
        await interaction.editReply({ content: `Removed the mapping for **${name}**.` });
    }

    // ---- /config role ----

    public async chatInputRoleVerified(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const role = interaction.options.getRole("role", true);
        setVerifiedRole(this.requiredGuild(interaction).id, role.id);
        await interaction.editReply({ content: `Verified role set to <@&${role.id}>.` });
    }

    // ---- /config channel ----

    public async chatInputChannelNotVerified(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const channel = interaction.options.getChannel("channel", true);
        if (!canSendMessages(channel)) {
            await interaction.editReply({ content: "That must be a text channel." });
            return;
        }
        setNotVerifiedChannel(this.requiredGuild(interaction).id, channel.id);
        await interaction.editReply({ content: `Not-verified channel set to <#${channel.id}>.` });
    }

    public async chatInputChannelManagement(interaction: Subcommand.ChatInputCommandInteraction) {
        await this.defer(interaction);
        const channel = interaction.options.getChannel("channel", true);
        if (!canSendMessages(channel)) {
            await interaction.editReply({ content: "That must be a text channel." });
            return;
        }
        setManagementChannel(this.requiredGuild(interaction).id, channel.id);
        await interaction.editReply({ content: `Management channel set to <#${channel.id}>.` });
    }

    // ---- autocomplete for /config team-roles remove name ----

    public override async autocompleteRun(interaction: AutocompleteInteraction) {
        if (
            interaction.options.getSubcommandGroup() !== "team-roles" ||
            interaction.options.getSubcommand() !== "remove"
        ) {
            await interaction.respond([]);
            return;
        }
        const focused = interaction.options.getFocused(true);
        const guildId = interaction.guildId;
        if (!guildId) {
            await interaction.respond([]);
            return;
        }
        const names = listTeamRoles(guildId).map((role) => role.name);
        const matches = focused.value
            ? names.filter((name) =>
                  name.toLowerCase().includes(String(focused.value).toLowerCase()),
              )
            : names;
        await interaction.respond(
            matches.slice(0, MAX_AUTOCOMPLETE_CHOICES).map((name) => ({ name, value: name })),
        );
    }
}
