import { TornApiClient, TornApiError } from "tornapi-typescript";
import { nextApiKey } from "./api-keys";

const API_CLIENT = new TornApiClient({
    defaultComment: `elims-${(new Date()).getFullYear()}`,
});

export type TornUser = {
    id: number;
    name: string;
    competition?: {
        team?: string;
    };
};

export type KeyOwner = {
    playerId: number;
    playerName: string;
};

type TornV2UserData = {
    profile?: { id: number; name: string };
    competition?: { name?: string; team?: string };
    name?: string;
    team?: string;
    error?: { code: number; error: string };
};

// Retryable when the chosen key is throttled/disabled; rotating may land on a healthy key.
const RETRYABLE_ERROR_CODES = new Set([
    TornApiError.TOO_MANY_REQUESTS,
    TornApiError.IP_BLOCK,
    TornApiError.KEY_TEMPORARILY_DISABLED_TO_INACTIVITY,
    TornApiError.DAILY_READ_LIMIT_REACHED,
    TornApiError.TEMPORARY_ERROR,
    TornApiError.BACKEND_ERROR_OCCURRED,
]);

function toTornUser(data: TornV2UserData): TornUser | null {
    if (!data.profile) return null;

    let team: string | undefined;
    if (data.name === "Elimination") {
        team = data.team;
    } else if (data.competition?.name === "Elimination") {
        team = data.competition.team;
    }

    return {
        id: data.profile.id,
        name: data.profile.name,
        competition: team ? { team } : undefined,
    };
}

export async function getUserByDiscordId(discordId: string): Promise<TornUser | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
        const apiKey = nextApiKey();
        if (!apiKey) {
            return null;
        }

        const data = (await API_CLIENT.getV2({
            section: "user",
            id: discordId,
            selections: ["profile", "competition"],
            key: apiKey.key,
        })) as TornV2UserData;

        if (data.error) {
            if (RETRYABLE_ERROR_CODES.has(data.error.code)) {
                continue;
            }
            return null;
        }
        return toTornUser(data);
    }
    return null;
}

// Validate a candidate key against Torn and read who owns it.
export type ApiKeyVerification =
    | { success: true; owner: KeyOwner }
    | { success: false; message: string };

export async function verifyApiKey(apiKey: string): Promise<ApiKeyVerification> {
    const profile = await API_CLIENT.getV2({
        section: "user",
        selections: ["profile"],
        key: apiKey,
    });
    if ("error" in profile) {
        return { success: false, message: describeKeyError(profile.error.code) };
    }

    return {
        success: true,
        owner: {
            playerId: profile.profile.id,
            playerName: profile.profile.name,
        },
    };
}

function describeKeyError(code: number | undefined): string {
    switch (code) {
        case TornApiError.INCORRECT_KEY:
            return "That does not look like a valid Torn API key.";
        case TornApiError.WRONG_TYPE:
            return "That key is not a user API key.";
        case TornApiError.KEY_FEDERAL_JAIL:
            return "The key's owner is in federal jail.";
        case TornApiError.KEY_TEMPORARILY_DISABLED_TO_INACTIVITY:
        case TornApiError.API_KEY_HAS_BEEN_PAUSED:
            return "That key has been disabled by Torn.";
        case TornApiError.ACCESS_LEVEL_KEY_NOT_HIGH:
            return "That key does not have access to profile data.";
        default:
            return `Torn rejected the key (${code ?? "unknown error"}).`;
    }
}
