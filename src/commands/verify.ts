import {ChatInputCommandInteraction, GuildMember, PermissionFlagsBits, SlashCommandBuilder} from 'discord.js';
import {verify} from '../services/verification';

export const data = new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification commands')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles) // Restrict to mods/admins by default
    .addSubcommand(subcommand =>
        subcommand
            .setName('member')
            .setDescription('Verify a specific member by their Discord account')
            .addUserOption(option =>
                option.setName('target')
                    .setDescription('The user to verify')
                    .setRequired(true)
            )
    )
    .addSubcommand(subcommand =>
        subcommand
            .setName('all')
            .setDescription('Verify all members who are not yet verified')
    );

export async function execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
        await interaction.reply({content: 'This command can only be used in a server.', flags: ["Ephemeral"]});
        return;
    }

    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'member') {
        await handleVerifyMember(interaction);
    } else if (subcommand === 'all') {
        await handleVerifyAll(interaction);
    } else {
        await interaction.reply({content: 'Unknown subcommand.', flags: ["Ephemeral"]});
    }
}

async function handleVerifyMember(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({flags: ["Ephemeral"]});

    const targetUser = interaction.options.getUser('target', true);
    let targetMember: GuildMember;

    try {
        targetMember = await interaction.guild!.members.fetch(targetUser.id);
    } catch (error) {
        await interaction.editReply({content: 'Could not find that member in this server.'});
        return;
    }

    // Reuse the verification service
    try {
        const result = await verify(targetMember);

        if (!result.verified) {
            await interaction.editReply({
                content: `Could not find a Torn account linked to <@${targetUser.id}>. They need to be verified with a Torn bot that supports Discord linking.`
            });
            return;
        }

        const statusLines = [`Verified <@${targetUser.id}> as **${result.nickname}**.`];

        if (!result.renamed) statusLines.push('⚠ Could not update nickname (check permissions).');
        if (!result.appliedVerifiedRole) statusLines.push('⚠ Could not add verified role.');
        if (!result.appliedTeamRole) statusLines.push('⚠ Could not apply team role.');

        await interaction.editReply({content: statusLines.join('\n')});

    } catch (error) {
        console.error('Verify member error:', error);
        await interaction.editReply({content: 'An error occurred during verification.'});
    }
}

async function handleVerifyAll(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({flags: ["Ephemeral"]});

    // 1. Fetch all members (ensure cache is full)
    await interaction.guild!.members.fetch();

    // 2. Filter unverified
    // We assume "Verified" role name. Ideally from config or finding it first.
    const verifiedRole = interaction.guild!.roles.cache.find(r => r.name === 'Verified');
    if (!verifiedRole) {
        await interaction.editReply({content: 'Could not find a role named "Verified". Please create it first.'});
        return;
    }

    const unverifiedMembers = interaction.guild!.members.cache.filter(m =>
        !m.user.bot && !m.roles.cache.has(verifiedRole.id)
    );

    if (unverifiedMembers.size === 0) {
        await interaction.editReply({content: 'All eligible members are already verified!'});
        return;
    }

    await interaction.editReply({content: `Found ${unverifiedMembers.size} unverified members. Starting verification process... (This may take a while due to API limits)`});

    let successCount = 0;
    let failCount = 0;
    let processedCount = 0;

    // 3. Process with rate limiting
    // Torn API limit is often 100/min. Let's aim safely for 1 request every 1.5 seconds (~40/min) to be safe with other bot usage.
    // Or closer to limit: 1 request every 0.7 seconds (~85/min).
    // Let's go with 1s delay.

    for (const [_, member] of unverifiedMembers) {
        try {
            const result = await verify(member);
            if (result.verified) {
                successCount++;
            } else {
                failCount++;
            }
        } catch (e) {
            failCount++;
        }

        processedCount++;

        // Update progress every 10 members or last one
        if (processedCount % 10 === 0 || processedCount === unverifiedMembers.size) {
            await interaction.editReply({
                content: `Processing: ${processedCount}/${unverifiedMembers.size}\nVerified: ${successCount}\nFailed/Unlinked: ${failCount}`
            });
        }

        // Wait 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await interaction.followUp({
        content: `**Verification Complete**\nTotal Processed: ${processedCount}\nSuccessfully Verified: ${successCount}\nFailed/Unlinked: ${failCount}`,
        flags: ["Ephemeral"]
    });
}
