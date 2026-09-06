import { Command } from "@sapphire/framework";
import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import {
    type ActivityStat,
    formatNumber,
    getActivityChart,
    listTrackedTeams,
} from "../lib/services/activity-chart";

const MAX_AUTOCOMPLETE_CHOICES = 25;

const STAT_DISPLAY: Record<ActivityStat, string> = {
    score: "Score",
    wins: "Wins",
    losses: "Losses",
};

function safeFilename(name: string): string {
    const sanitized = name
        .replace(/[^A-Za-z0-9._ -]/g, "")
        .trim()
        .replace(/\s+/g, "-");
    return (sanitized || "team").slice(0, 80);
}

export class ActivityCommand extends Command {
    public constructor(context: Command.LoaderContext, options: Command.Options) {
        super(context, {
            ...options,
            name: "activity",
            description: "Show a chart of a team's tracked stat history",
        });
    }

    public override registerApplicationCommands(registry: Command.Registry) {
        registry.registerChatInputCommand((builder) =>
            builder
                .setName("activity")
                .setDescription("Show a chart of a team's tracked stat history")
                .addStringOption((option) =>
                    option
                        .setName("team")
                        .setDescription("What team do you want the chart for.")
                        .setRequired(true)
                        .setAutocomplete(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("stat")
                        .setDescription("Which stat should be on the chart.")
                        .setRequired(true)
                        .addChoices(
                            { name: STAT_DISPLAY.score, value: "score" },
                            { name: STAT_DISPLAY.wins, value: "wins" },
                            { name: STAT_DISPLAY.losses, value: "losses" },
                        ),
                ),
        );
    }

    public override async chatInputRun(interaction: ChatInputCommandInteraction) {
        await interaction.deferReply();

        const teamName = interaction.options.getString("team", true);
        const stat = interaction.options.getString("stat", true) as ActivityStat;

        try {
            const chart = await getActivityChart(teamName, stat);
            if (!chart) {
                await interaction.editReply({
                    content: `No tracked history for a team named "${teamName}" yet.`,
                });
                return;
            }

            const summary = [
                `**${chart.resolvedName}** — ${STAT_DISPLAY[stat]} history (${formatNumber(chart.count)} data points)`,
                `Earliest: ${formatNumber(chart.firstValue)} · Latest: **${formatNumber(chart.lastValue)}**${chart.cached ? " · *cached image*" : ""}`,
            ].join("\n");

            await interaction.editReply({
                content: summary,
                files: [
                    {
                        attachment: chart.png,
                        name: `${safeFilename(chart.resolvedName)}-${stat}.png`,
                    },
                ],
            });
        } catch (error) {
            console.error("Activity command error:", error);
            await interaction.editReply({
                content: "An error occurred while generating the chart.",
            });
        }
    }

    public override async autocompleteRun(interaction: AutocompleteInteraction) {
        const focused = interaction.options.getFocused(true);
        if (focused.name !== "team") {
            await interaction.respond([]);
            return;
        }
        const fragment = String(focused.value).toLowerCase();
        const names = listTrackedTeams();
        const matches = fragment
            ? names.filter((name) => name.toLowerCase().includes(fragment))
            : names;
        await interaction.respond(
            matches.slice(0, MAX_AUTOCOMPLETE_CHOICES).map((name) => ({ name, value: name })),
        );
    }
}
