import type { GuildMember, Role } from "discord.js";
import { getGuildSettings } from "./guild-settings";
import { findTeamRole } from "./team-roles";
import { getUserByDiscordId } from "./torn";

export type VerificationSuccess = {
    verified: true;
    nickname: string;
    renamed: boolean;
    appliedVerifiedRole: boolean;
    inCompetition: boolean;
    appliedTeamRole: boolean;
};

export type VerificationResult = { verified: false } | VerificationSuccess;

async function resolveRole(member: GuildMember, roleId: string | null): Promise<Role | null> {
    if (!roleId) {
        return null;
    }
    try {
        return await member.guild.roles.fetch(roleId);
    } catch {
        return null;
    }
}

export function formatSuccessMessage(memberId: string, result: VerificationSuccess): string {
    const lines = [`Verified <@${memberId}> as **${result.nickname}**.`];
    if (!result.renamed) lines.push("⚠ Could not update nickname (check permissions).");
    if (!result.appliedVerifiedRole)
        lines.push(
            "⚠ Could not add the verified role (is it configured and does the bot have Manage Roles?).",
        );
    if (!result.appliedTeamRole)
        lines.push("⚠ Could not apply the team role (is the team mapped?).");
    return lines.join("\n");
}

export async function verify(member: GuildMember): Promise<VerificationResult> {
    const tornUser = await getUserByDiscordId(member.id);
    if (!tornUser) {
        return { verified: false };
    }

    const settings = getGuildSettings(member.guild.id);

    let renamed = false;
    const nickname = `${tornUser.name} [${tornUser.id}]`;
    try {
        await member.setNickname(nickname);
        renamed = true;
    } catch (error) {
        console.warn("Failed to update nickname:", error);
    }

    let appliedVerifiedRole = false;
    const verifiedRole = await resolveRole(member, settings.verifiedRoleId);
    if (verifiedRole) {
        try {
            await member.roles.add(verifiedRole);
            appliedVerifiedRole = true;
        } catch (error) {
            console.warn("Failed to apply verified role:", error);
        }
    }

    let appliedTeamRole = false;
    const teamName = tornUser.competition?.team;
    if (teamName) {
        const teamRoleId = findTeamRole(member.guild.id, teamName)?.roleId ?? null;
        const teamRole = await resolveRole(member, teamRoleId);
        if (teamRole) {
            try {
                await member.roles.add(teamRole);
                appliedTeamRole = true;
            } catch (error) {
                console.warn(`Failed to apply team role for "${teamName}":`, error);
            }
        }
    }

    return {
        verified: true,
        nickname,
        renamed,
        appliedVerifiedRole,
        inCompetition: Boolean(teamName),
        appliedTeamRole,
    };
}
