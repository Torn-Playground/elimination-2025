import "@sapphire/plugin-subcommands/register";
import { SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits } from "discord.js";
import { DISCORD_TOKEN } from "./config";
import { runMigrations } from "./lib/db";
import { startActivityTracking } from "./lib/services/activity";
import { startPushReminders } from "./lib/services/push-reminders";
import { startTeamMemberSync } from "./lib/services/team-members";
import { startWebServer } from "./web/server";

async function main(): Promise<void> {
    await runMigrations();
    startActivityTracking();
    startTeamMemberSync();

    const client = new SapphireClient({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
        baseUserDirectory: __dirname,
        loadMessageCommandListeners: false,
    });

    await client.login(DISCORD_TOKEN);
    startPushReminders(client);
    startWebServer();
}

main().catch((error) => {
    console.error("Failed to start:", error);
    process.exit(1);
});
