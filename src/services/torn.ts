import { TornApiClient } from "tornapi-typescript";
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
            console.error("Torn API Error:", data.error);
            return null;
        }

        data.competition;

        return {
            id: data.profile.id,
            name: data.profile.name,
            competition:
                data.competition?.name === "Elimination"
                    ? { team: data.competition.team }
                    : undefined,
        };
    } catch (error) {
        console.error("Failed to fetch Torn user:", error);
        return null;
    }
}
