import "dotenv/config";
import path from "node:path";

function requiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing environment variable: ${key}`);

    return value;
}

export const DISCORD_TOKEN = requiredEnv("DISCORD_TOKEN");

export const DATABASE_PATH =
    process.env.DATABASE_PATH ?? path.resolve(process.cwd(), "data", "elimination.db");

export const TORN_VERIFY_URL =
    "https://discord.com/api/oauth2/authorize?client_id=439014098987122698&redirect_uri=https%3A%2F%2Fwww.torn.com%2Fdiscord.php&response_type=code&scope=identify";
