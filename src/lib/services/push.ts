import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { pushReminders, pushSettings as settingsTable, pushSlots as slots } from "../db/schema";

const HOUR_MS = 3_600_000;
export const DEFAULT_LEAD_MINUTES = 60;

export type PushSettings = {
    guildId: string | null;
    channelId: string | null;
    roleId: string | null;
    adminRoleIds: string[];
    leadMinutes: number;
    start: Date | null;
    end: Date | null;
};

type SettingsPatch = Partial<{
    guildId: string | null;
    channelId: string | null;
    roleId: string | null;
    adminRoleIds: string | null;
    leadMinutes: number;
    start: Date | null;
    end: Date | null;
}>;

export type ScheduleEntry = {
    start: Date;
    userId: string | null;
    claimedAt: Date | null;
};

export function toMysqlDatetime(date: Date): string {
    return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseAdminRoleIds(raw: string | null): string[] {
    if (!raw) return [];
    try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value)
            ? value.filter((id): id is string => typeof id === "string")
            : [];
    } catch {
        return [];
    }
}

export async function getPushSettings(): Promise<PushSettings> {
    const [row] = await db.select().from(settingsTable).orderBy(asc(settingsTable.id)).limit(1);
    if (!row) {
        return {
            guildId: null,
            channelId: null,
            roleId: null,
            adminRoleIds: [],
            leadMinutes: DEFAULT_LEAD_MINUTES,
            start: null,
            end: null,
        };
    }
    return {
        guildId: row.guildId,
        channelId: row.channelId,
        roleId: row.roleId,
        adminRoleIds: parseAdminRoleIds(row.adminRoleIds),
        leadMinutes: row.leadMinutes,
        start: row.start,
        end: row.end,
    };
}

async function updateSettings(fields: SettingsPatch): Promise<void> {
    await db
        .insert(settingsTable)
        .values({ id: 1, ...fields })
        .onDuplicateKeyUpdate({ set: fields });
}

export function setPushChannel(guildId: string, channelId: string): Promise<void> {
    return updateSettings({ guildId, channelId });
}

export function setPushRole(roleId: string): Promise<void> {
    return updateSettings({ roleId });
}

export function setPushLead(minutes: number): Promise<void> {
    return updateSettings({ leadMinutes: minutes });
}

export async function setPushWindow(start: Date, end: Date): Promise<void> {
    await db.transaction(async (tx) => {
        await tx.delete(slots);
        await tx.delete(pushReminders);
        await tx
            .insert(settingsTable)
            .values({ id: 1, start, end })
            .onDuplicateKeyUpdate({ set: { start, end } });
    });
}

export function clearPushWindow(): Promise<void> {
    return updateSettings({ start: null, end: null });
}

export async function listAdminRoles(): Promise<string[]> {
    return (await getPushSettings()).adminRoleIds;
}

export async function addAdminRole(roleId: string): Promise<boolean> {
    const settings = await getPushSettings();
    if (settings.adminRoleIds.includes(roleId)) return false;
    const ids = [...settings.adminRoleIds, roleId];
    await updateSettings({ adminRoleIds: JSON.stringify(ids) });
    return true;
}

export async function removeAdminRole(roleId: string): Promise<boolean> {
    const settings = await getPushSettings();
    const ids = settings.adminRoleIds.filter((id) => id !== roleId);
    if (ids.length === settings.adminRoleIds.length) return false;
    await updateSettings({ adminRoleIds: JSON.stringify(ids) });
    return true;
}

/** One entry per hour of the window; free hours have userId = null. */
export async function listSchedule(): Promise<ScheduleEntry[]> {
    const settings = await getPushSettings();
    if (!settings.start || !settings.end || settings.end <= settings.start) return [];
    const windowStart = settings.start;
    const windowEnd = settings.end;

    const claimedRows = await db
        .select()
        .from(slots)
        .where(and(gte(slots.start, windowStart), lt(slots.start, windowEnd)))
        .orderBy(asc(slots.start));

    const claimedByStart = new Map(claimedRows.map((row) => [row.start.getTime(), row]));
    const entries: ScheduleEntry[] = [];
    for (let time = windowStart.getTime(); time < windowEnd.getTime(); time += HOUR_MS) {
        const claimed = claimedByStart.get(time);
        entries.push(
            claimed
                ? { start: claimed.start, userId: claimed.userId, claimedAt: claimed.claimedAt }
                : { start: new Date(time), userId: null, claimedAt: null },
        );
    }
    return entries;
}

function windowHoursUpTo(now: Date, lowerMs: number, endMs: number): Date[] {
    const starts: Date[] = [];
    // first whole-hour boundary strictly after now, but never before the window start
    let time = Math.max(now.getTime() - (now.getTime() % HOUR_MS) + HOUR_MS, lowerMs);
    for (; time < endMs; time += HOUR_MS) {
        starts.push(new Date(time));
    }
    return starts;
}

function alignToHour(date: Date): Date {
    return new Date(Math.floor(date.getTime() / HOUR_MS) * HOUR_MS);
}

export type ClaimResult = "ok" | "taken" | "locked" | "no-window";

export async function claimSlot(start: Date, userId: string): Promise<ClaimResult> {
    start = alignToHour(start);
    const settings = await getPushSettings();
    if (!settings.start || !settings.end) return "no-window";
    if (start.getTime() < settings.start.getTime() || start.getTime() >= settings.end.getTime()) {
        return "no-window";
    }
    if (start.getTime() <= Date.now()) return "locked";

    try {
        return await db.transaction(async (tx) => {
            const [row] = await tx
                .select()
                .from(slots)
                .where(eq(slots.start, start))
                .limit(1)
                .for("update");
            if (row?.userId) return "taken";
            const values = { start, userId, claimedAt: new Date() };
            if (row) {
                await tx.update(slots).set(values).where(eq(slots.start, start));
            } else {
                await tx.insert(slots).values(values);
            }
            return "ok";
        });
    } catch {
        return "taken";
    }
}

export type ReleaseResult = "ok" | "free" | "locked" | "not-owner";

/** force allows admins to release anyone's slot. Slots that already started are locked. */
export async function releaseSlot(
    start: Date,
    userId: string,
    force: boolean,
): Promise<ReleaseResult> {
    start = alignToHour(start);
    try {
        return await db.transaction(async (tx) => {
            const [row] = await tx
                .select()
                .from(slots)
                .where(eq(slots.start, start))
                .limit(1)
                .for("update");
            if (!row?.userId) return "free";
            if (row.userId !== userId && !force) return "not-owner";
            await tx.delete(slots).where(eq(slots.start, start));
            return "ok";
        });
    } catch {
        return "free";
    }
}

export type DueReminder = {
    user: { start: Date; userId: string }[];
    role: Date[];
};

/** Claimed slots need a @user ping; unclaimed hour-starts within the lead need a role ping. */
export async function dueReminders(now: Date): Promise<DueReminder> {
    const settings = await getPushSettings();
    const result: DueReminder = { user: [], role: [] };
    if (!settings.start || !settings.end || !settings.channelId) return result;

    const leadMs = settings.leadMinutes * 60_000;
    const horizon = Math.min(now.getTime() + leadMs, settings.end.getTime());
    // Only hours that are actually part of the window may be reminded: the
    // window start may still be hours/days away while the lead reaches beyond it.
    const candidates = windowHoursUpTo(now, settings.start.getTime(), horizon);
    if (candidates.length === 0) return result;

    const claimed = await db
        .select()
        .from(slots)
        .where(and(gte(slots.start, candidates[0]), lt(slots.start, new Date(horizon))));

    const claimedByStart = new Map(claimed.map((row) => [row.start.getTime(), row]));
    const reminded = await db
        .select()
        .from(pushReminders)
        .where(
            and(
                gte(pushReminders.start, candidates[0]),
                lt(pushReminders.start, new Date(horizon)),
            ),
        );
    const remindedKey = (start: Date, kind: "user" | "role") => `${start.getTime()}:${kind}`;
    const remindedSet = new Set(
        reminded.map((row) => remindedKey(row.start, row.kind as "user" | "role")),
    );

    for (const start of candidates) {
        const row = claimedByStart.get(start.getTime());
        if (row?.userId) {
            if (!remindedSet.has(remindedKey(start, "user"))) {
                result.user.push({ start, userId: row.userId });
            }
        } else if (!remindedSet.has(remindedKey(start, "role"))) {
            result.role.push(start);
        }
    }
    return result;
}

/** Records that a reminder was sent; duplicate (start, kind) rows are ignored. */
export async function markReminderSent(start: Date, kind: "user" | "role"): Promise<void> {
    await db.execute(
        sql`INSERT IGNORE INTO push_reminders (start, kind, sent_at) VALUES (${toMysqlDatetime(start)}, ${kind}, NOW())`,
    );
}
