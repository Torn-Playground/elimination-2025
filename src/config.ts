import dotenv from "dotenv";

dotenv.config();

function validateEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
}

export const config = {
    DISCORD_TOKEN: validateEnv("DISCORD_TOKEN"),
    CLIENT_ID: validateEnv("CLIENT_ID"),
    GUILD_ID: validateEnv("GUILD_ID"),
    TORN_API_KEY: validateEnv("TORN_API_KEY"),
};

export const ROLE_MAP: Record<string, string> = {
    "Touching Grass": "1545780789843595304",
    "Touching grass": "1545780789843595304",
};

export const VERIFIED_ROLE_NAME = "Verified";

export const NOT_VERIFIED_CHANNEL_NAME = "not-verified";

export const TORN_VERIFY_URL = "https://discord.com/channels/681922682949992581/909160345736728647/1533191612140753058";
