import "dotenv/config";

function requiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) throw new Error(`Missing environment variable: ${key}`);

    return value;
}

export const DISCORD_TOKEN = requiredEnv("DISCORD_TOKEN");

export const DATABASE_URL = requiredEnv("DATABASE_URL");

export const TORN_VERIFY_URL =
    "https://discord.com/api/oauth2/authorize?client_id=439014098987122698&redirect_uri=https%3A%2F%2Fwww.torn.com%2Fdiscord.php&response_type=code&scope=identify";

export const ELIMINATION_CRON = process.env.ELIMINATION_CRON ?? "10 */5 * * * *";

export const OWNER_ID = process.env.OWNER_ID ?? null;
export const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? null;
export const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET ?? null;
export const WEB_PUBLIC_URL = process.env.WEB_PUBLIC_URL ?? null;
export const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
