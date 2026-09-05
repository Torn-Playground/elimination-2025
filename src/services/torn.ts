import { TornApiClient, type UserCompetitionResponse } from "tornapi-typescript";
import { config } from "../config";

export interface TornUser {
    id: number;
    name: string;
    competition?: {
        team?: string;
    };
}

const API_CLIENT = new TornApiClient({
    defaultComment: "elims-2025",
});

export async function getUserByDiscordId(discordId: string): Promise<TornUser | null> {
    try {
        const data = await API_CLIENT.getV2({
            section: "user",
            id: discordId,
            selections: ["profile", "competition"],
            key: config.TORN_API_KEY,
        });
        if ("error" in data) {
            console.error(`Torn API Error for user '${discordId}':`, data.error);
            return null;
        }

        let competition: UserCompetitionResponse["competition"] | undefined;
        if ("name" in data && data.name === "Elimination" && "attacks" in data && "score" in data && "team" in data) {
            competition = {
                name: "Elimination",
                score: data.score as number,
                team: data.team as string,
                attacks: data.attacks as number,
            }
        } else {
            competition = data.competition;
        }

        console.log("User Competition", data.profile.id, JSON.stringify(data.competition))
        return {
            id: data.profile.id,
            name: data.profile.name,
            competition:
                competition?.name === "Elimination"
                    ? { team: competition.team }
                    : undefined,
        };
    } catch (error) {
        console.error("Failed to fetch Torn user:", error);
        return null;
    }
}
