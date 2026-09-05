import type { GuildMember } from "discord.js";
import { ROLE_MAP, VERIFIED_ROLE_NAME } from "../config";
import { getUserByDiscordId } from "./torn";

export type VerificationSuccess = {
    verified: true;
    nickname: string;
    renamed: boolean;
    appliedVerifiedRole: boolean;
    inCompetition: boolean;
    appliedTeamRole: boolean;
};

type VerificationResult = { verified: false } | VerificationSuccess;

export function formatSuccessMessage(memberId: string, result: VerificationSuccess): string {
    const lines = [`Verified <@${memberId}> as **${result.nickname}**.`];
    if (!result.renamed) lines.push("⚠ Could not update nickname (check permissions).");
    if (!result.appliedVerifiedRole) lines.push("⚠ Could not add verified role.");
    if (!result.appliedTeamRole) lines.push("⚠ Could not apply team role.");
    return lines.join("\n");
}

export async function verify(member: GuildMember): Promise<VerificationResult> {
    const tornUser = await getUserByDiscordId(member.id);
    if (!tornUser) {
        return { verified: false };
    }

    let renamed: boolean = false;
    const nickname = `${tornUser.name} [${tornUser.id}]`;
    try {
        await member.setNickname(nickname);
        renamed = true;
    } catch (error) {
        console.warn("Failed to update nickname:", error);
    }

    let appliedVerifiedRole = false;
    const verifiedRole = member.guild.roles.cache.find((r) => r.name === VERIFIED_ROLE_NAME);
    if (verifiedRole) {
        try {
            await member.roles.add(verifiedRole);
            appliedVerifiedRole = true;
        } catch (error) {
            console.warn("Failed to apply verified role:", error);
        }
    } else {
        console.warn("Verified role not found in guild.");
    }

    let inCompetition = false;
    let appliedTeamRole = false;
    if (tornUser.competition) {
        inCompetition = true;

        const teamName = tornUser.competition.team;
        if (teamName) {
            const teamRole =
                teamName in ROLE_MAP
                    ? member.guild.roles.cache.get(ROLE_MAP[teamName])
                    : member.guild.roles.cache.find((r) => r.name === teamName);
            if (teamRole) {
                try {
                    await member.roles.add(teamRole);
                    appliedTeamRole = true;
                } catch (error) {
                    console.warn(`Failed to apply team role for "${teamName}":`, error);
                }
            } else {
                console.warn(`Role for team "${teamName}" not found.`);
            }
        }
    }

    return {
        verified: true,
        nickname,
        renamed,
        appliedVerifiedRole,
        inCompetition,
        appliedTeamRole,
    };
}
