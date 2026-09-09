import { Command } from "@sapphire/framework";
import {
    type ChatInputCommandInteraction,
    type Guild,
    type Message,
    MessageFlags,
    type MessageReaction,
    PermissionFlagsBits,
    type Snowflake,
} from "discord.js";

const MESSAGE_LINK_PATTERN = /discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
const CUSTOM_EMOJI_PATTERN = /^<a?:(\w+):(\d+)>$/;
const CUSTOM_EMOJI_IDENTIFIER_PATTERN = /^(\w+):(\d+)$/;
const REACTION_BATCH_SIZE = 100;

interface ParsedMessageLink {
    guildId: string;
    channelId: string;
    messageId: string;
}

function parseMessageLink(raw: string): ParsedMessageLink | null {
    const match = raw.trim().match(MESSAGE_LINK_PATTERN);
    if (!match) return null;
    const [, guildId, channelId, messageId] = match;
    return { guildId, channelId, messageId };
}

/** Returns the emoji id for a custom emoji input, or null for unicode input. */
function parseCustomEmojiId(raw: string): string | null {
    const wrapped = raw.trim().match(CUSTOM_EMOJI_PATTERN);
    if (wrapped) return wrapped[2];
    const bare = raw.trim().match(CUSTOM_EMOJI_IDENTIFIER_PATTERN);
    if (bare) return bare[2];
    return null;
}

function isTargetReaction(reaction: MessageReaction, emojiInput: string): boolean {
    const customId = parseCustomEmojiId(emojiInput);
    if (customId !== null) {
        return reaction.emoji.id === customId;
    }
    return reaction.emoji.name === emojiInput.trim();
}

async function fetchAllReactionUsers(reaction: MessageReaction): Promise<string[]> {
    const userIds: string[] = [];
    let after: Snowflake | undefined;
    for (;;) {
        const batch = await reaction.users.fetch({ limit: REACTION_BATCH_SIZE, after });
        userIds.push(...batch.keys());
        if (batch.size < REACTION_BATCH_SIZE) break;
        after = batch.lastKey();
    }
    return userIds;
}

// ponytail: temporary command, delete the file to remove it.
export class GrantCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: "grant",
            description: "Grant a role to everyone who reacted to a message (temporary)",
            preconditions: ["GuildOnly"],
            requiredUserPermissions: ["ManageRoles"],
        });
    }

    public override registerApplicationCommands(registry: Command.Registry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName("grant")
                .setDescription("Grant a role to everyone who reacted to a message (temporary)")
                .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
                .addStringOption((option) =>
                    option
                        .setName("message")
                        .setDescription("Link to the message with the reactions")
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("emoji")
                        .setDescription("The emoji (unicode or <:name:id>)")
                        .setRequired(true),
                )
                .addRoleOption((option) =>
                    option
                        .setName("role")
                        .setDescription("The role to grant to reactors")
                        .setRequired(true),
                ),
        );
    }

    public override async chatInputRun(interaction: ChatInputCommandInteraction) {
        const guild = interaction.guild;
        if (!guild) {
            await interaction.reply({
                content: "This command can only be used in a server.",
                flags: [MessageFlags.Ephemeral],
            });
            return;
        }
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

        const rawLink = interaction.options.getString("message", true);
        const emojiInput = interaction.options.getString("emoji", true);
        const role = interaction.options.getRole("role", true);

        const link = parseMessageLink(rawLink);
        if (!link) {
            await interaction.editReply({
                content: "That does not look like a Discord message link.",
            });
            return;
        }
        if (link.guildId !== guild.id) {
            await interaction.editReply({
                content: "The message link must point to a message in this server.",
            });
            return;
        }

        const message = await this.fetchMessage(guild, link.channelId, link.messageId);
        if (!message) {
            await interaction.editReply({
                content: "Could not find that message (is it in a channel the bot can read?).",
            });
            return;
        }

        const reaction = [...message.reactions.cache.values()].find((candidate) =>
            isTargetReaction(candidate, emojiInput),
        );
        if (!reaction) {
            const available = [...message.reactions.cache.keys()].join(" ") || "none";
            await interaction.editReply({
                content: `No reaction matching that emoji on the message. Available: ${available}`,
            });
            return;
        }

        if (role.id === guild.roles.everyone.id) {
            await interaction.editReply({ content: "@everyone cannot be granted." });
            return;
        }

        const userIds = await fetchAllReactionUsers(reaction);
        const granted: string[] = [];
        const failed: string[] = [];
        for (const userId of userIds) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                failed.push(`<@${userId}> (no longer in server)`);
                continue;
            }
            if (member.roles.cache.has(role.id)) {
                continue;
            }
            try {
                await member.roles.add(role.id);
                granted.push(`<@${userId}>`);
            } catch {
                failed.push(`<@${userId}>`);
            }
        }

        await interaction.editReply({
            content: [
                `Granted <@&${role.id}> to **${granted.length}** reactor${granted.length === 1 ? "" : "s"}.`,
                failed.length > 0
                    ? `Skipped **${failed.length}**: ${failed.slice(0, 10).join(", ")}${
                          failed.length > 10 ? `… (+${failed.length - 10} more)` : ""
                      }`
                    : null,
            ]
                .filter((line) => line !== null)
                .join("\n"),
        });
    }

    private async fetchMessage(
        guild: Guild,
        channelId: string,
        messageId: string,
    ): Promise<Message | null> {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel?.isTextBased()) return null;
        return await channel.messages.fetch(messageId).catch(() => null);
    }
}
