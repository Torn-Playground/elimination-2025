import {Events, GuildMember} from 'discord.js';
import {verify} from "../services/verification";

export const name = Events.GuildMemberAdd;

export async function execute(member: GuildMember) {
    console.log(`User joined: ${member.id}, attempting auto-verification...`);
    try {
        const verificationResult = await verify(member)
        if (!verificationResult.verified) {
            console.log(`Verification failed for ${member.id}.`);
            return;
        }

        if (!verificationResult.renamed) {
            console.log(`Failed to rename user ${member.id} to ${verificationResult.nickname}.`);
        }
        if (!verificationResult.appliedVerifiedRole) {
            console.log(`Failed to apply verified role for ${verificationResult.nickname}.`);
        }
        if (!verificationResult.appliedTeamRole) {
            console.log(`Failed to apply team role for ${verificationResult.nickname}.`);
        }
    } catch (error) {
        console.error('Error in guildMemberAdd:', error);
    }
}
