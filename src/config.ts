import dotenv from 'dotenv';

dotenv.config();

function validateEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing environment variable: ${key}`);
    }
    return value;
}

export const config = {
    DISCORD_TOKEN: validateEnv('DISCORD_TOKEN'),
    CLIENT_ID: validateEnv('CLIENT_ID'),
    GUILD_ID: validateEnv('GUILD_ID'),
    TORN_API_KEY: validateEnv('TORN_API_KEY'),
};

export const ROLE_MAP: Record<string, string> = {
    "Village Idiots": "1446485077008846848"
}