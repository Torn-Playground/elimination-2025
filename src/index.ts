import "@sapphire/plugin-subcommands/register";
import { SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits } from "discord.js";
import { DISCORD_TOKEN } from "./config";
import { runMigrations } from "./lib/db";
import { startActivityTracking } from "./lib/services/activity";

runMigrations();
startActivityTracking();

const client = new SapphireClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
    baseUserDirectory: __dirname,
    loadMessageCommandListeners: false,
});

void client.login(DISCORD_TOKEN).catch((error) => {
    console.error("Failed to log in:", error);
    process.exit(1);
});
