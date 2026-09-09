import type { SapphireClient } from "@sapphire/framework";
import { Cron } from "croner";
import { WEB_PUBLIC_URL } from "../../config";
import { dueReminders, getPushSettings, markReminderSent } from "./push";

const LOG_PREFIX = "[push]";
const TICK_SECONDS = 20;

type Sendable = { send: (content: string) => Promise<unknown> };

export function formatUtcWindow(start: Date): string {
    const day = start.toISOString().slice(0, 10);
    const hour = String(start.getUTCHours()).padStart(2, "0");
    const endHour = String((start.getUTCHours() + 1) % 24).padStart(2, "0");
    return `${day} ${hour}:00–${endHour}:00 UTC`;
}

export function startPushReminders(client: SapphireClient): void {
    const job = new Cron(
        `*/${TICK_SECONDS} * * * * *`,
        { name: "push-reminders", catch: reportError },
        () => void tick(client),
    );
    console.info(
        `${LOG_PREFIX} reminders started (tick ${TICK_SECONDS}s, next run ${job.nextRun()?.toISOString() ?? "never"}).`,
    );
}

let running = false;
let lastFailure: string | null = null;

async function tick(client: SapphireClient): Promise<void> {
    if (running) return;
    running = true;
    try {
        const settings = await getPushSettings();
        if (!settings.channelId) return;
        const due = await dueReminders(new Date());
        const channel = await client.channels.fetch(settings.channelId).catch(() => null);
        if (!channel?.isTextBased()) {
            if (lastFailure !== "channel") {
                lastFailure = "channel";
                console.warn(`${LOG_PREFIX} reminder channel ${settings.channelId} unavailable.`);
            }
            return;
        }
        lastFailure = null;
        await sendDue(channel as unknown as Sendable, due.user, due.role);
    } catch (error) {
        reportFailure(error instanceof Error ? error.message : String(error));
    } finally {
        running = false;
    }
}

function reportFailure(message: string): void {
    if (message !== lastFailure) {
        lastFailure = message;
        console.warn(`${LOG_PREFIX} ${message}`);
    }
}

function reportError(error: unknown): void {
    reportFailure(error instanceof Error ? error.message : String(error));
}

async function sendDue(
    channel: Sendable,
    userReminders: { start: Date; userId: string }[],
    roleReminders: Date[],
): Promise<void> {
    const settings = await getPushSettings();
    for (const reminder of userReminders) {
        try {
            const message = `⏰ <@${reminder.userId}> — your push window **${formatUtcWindow(reminder.start)}** starts in ~${minutesUntil(reminder.start)} min.`;
            await channel.send(message);
            await markReminderSent(reminder.start, "user");
        } catch (error) {
            console.warn(`${LOG_PREFIX} failed to send user reminder:`, error);
        }
    }
    if (!settings.roleId) return;
    const claimUrl = WEB_PUBLIC_URL ? ` Claim it here: ${WEB_PUBLIC_URL}` : "";
    for (const start of roleReminders) {
        try {
            const message = `📢 <@&${settings.roleId}> — unclaimed push window **${formatUtcWindow(start)}** starts in ~${minutesUntil(start)} min.${claimUrl}`;
            await channel.send(message);
            await markReminderSent(start, "role");
        } catch (error) {
            console.warn(`${LOG_PREFIX} failed to send role reminder:`, error);
        }
    }
}

function minutesUntil(start: Date): number {
    return Math.max(1, Math.round((start.getTime() - Date.now()) / 60_000));
}
