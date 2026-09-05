import { Client, Events, GatewayIntentBits, REST, Routes } from "discord.js";
import * as verifyCommand from "./commands/verify";
import * as verifySelfCommand from "./commands/verify_self";
import { config } from "./config";
import * as guildMemberAddEvent from "./events/guildMemberAdd";

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

// Command Registration
const commands = [verifySelfCommand.data.toJSON(), verifyCommand.data.toJSON()];

const rest = new REST({ version: "10" }).setToken(config.DISCORD_TOKEN);

(async () => {
    try {
        console.log("Started refreshing application (/) commands.");

        await rest.put(Routes.applicationGuildCommands(config.CLIENT_ID, config.GUILD_ID), {
            body: commands,
        });

        console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
        console.error(error);
    }
})();

client.once(Events.ClientReady, (c) => {
    console.log(`Ready! Logged in as ${c.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === verifySelfCommand.data.name) {
        await verifySelfCommand.execute(interaction);
    } else if (interaction.commandName === verifyCommand.data.name) {
        await verifyCommand.execute(interaction);
    }
});

client.on(Events.GuildMemberAdd, guildMemberAddEvent.execute);

void client.login(config.DISCORD_TOKEN);
