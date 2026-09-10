import { Cron } from "croner";
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import { TEAM_MEMBERS_CRON } from "../../config";
import { db } from "../db";
import {
    eliminationTeamMembers as members,
    eliminationTeamSnapshots as snapshots,
    eliminationTeamMemberSync as sync,
} from "../db/schema";
import {
    type EliminationTeamMember,
    getEliminationStandings,
    getEliminationTeamMembers,
} from "./torn";

const LOG_PREFIX = "[team-members]";
const PAGE_LIMIT = 100;
const LIST_SYNC_MS = 10 * 60_000;

export type TeamRefreshedHandler = (teamId: number) => void | Promise<void>;

const handlers = new Set<TeamRefreshedHandler>();

export function onTeamRefreshed(handler: TeamRefreshedHandler): () => void {
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
}

export function startTeamMemberSync(): void {
    let job: Cron;
    try {
        job = new Cron(
            TEAM_MEMBERS_CRON,
            { name: "team-members", catch: reportError },
            () => void tick(),
        );
    } catch (error) {
        throw new Error(
            `Invalid TEAM_MEMBERS_CRON pattern '${TEAM_MEMBERS_CRON}': ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    console.info(
        `${LOG_PREFIX} started (cron '${TEAM_MEMBERS_CRON}', next run ${job.nextRun()?.toISOString() ?? "never"}).`,
    );
    void tick();
}

let running = false;
let lastFailure: string | null = null;
let lastListSyncAt = 0;

async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        if (Date.now() - lastListSyncAt >= LIST_SYNC_MS) {
            await syncTeamList();
            lastListSyncAt = Date.now();
        }

        const cursor = await pickNextTeam();
        if (!cursor) {
            reportFailure("no elimination teams known yet; skipping");
            return;
        }
        if (lastFailure) {
            console.info(`${LOG_PREFIX} resumed.`);
            lastFailure = null;
        }
        await refreshPage(cursor);
    } catch (error) {
        reportFailure(error instanceof Error ? error.message : String(error));
    } finally {
        running = false;
    }
}

type SyncCursor = typeof sync.$inferSelect;

async function syncTeamList(): Promise<void> {
    const standings = await getEliminationStandings();
    if (!standings || standings.length === 0) return;
    await db
        .insert(sync)
        .ignore()
        .values(standings.map((team) => ({ teamId: team.id })));
}

async function pickNextTeam(): Promise<SyncCursor | undefined> {
    const rows = await db
        .select()
        .from(sync)
        .orderBy(sql`${sync.refreshedAt} IS NOT NULL`, asc(sync.refreshedAt), asc(sync.teamId))
        .limit(1);
    return rows[0];
}

async function refreshPage(cursor: SyncCursor): Promise<void> {
    const page = await getEliminationTeamMembers(cursor.teamId, cursor.nextOffset, PAGE_LIMIT);
    if (page === null) {
        reportFailure(`team ${cursor.teamId}: Torn temporarily closed; skipping`);
        return;
    }

    const fetchedAt = new Date();
    const startedAt = cursor.refreshStartedAt ?? fetchedAt;
    if (cursor.refreshStartedAt === null) {
        await db
            .update(sync)
            .set({ refreshStartedAt: fetchedAt })
            .where(eq(sync.teamId, cursor.teamId));
    }

    if (page.members.length > 0) {
        await upsertMembers(cursor.teamId, page.members, fetchedAt);
    }

    const hasMore = page.hasMore && page.members.length > 0;
    if (hasMore) {
        await db
            .update(sync)
            .set({ nextOffset: cursor.nextOffset + page.members.length })
            .where(eq(sync.teamId, cursor.teamId));
        return;
    }

    await completeRefresh(cursor.teamId, startedAt);
}

async function upsertMembers(
    teamId: number,
    roster: EliminationTeamMember[],
    refreshedAt: Date,
): Promise<void> {
    await db
        .insert(members)
        .values(
            roster.map((member) => ({
                teamId,
                userId: member.id,
                name: member.name,
                level: member.level,
                lastAction: member.lastAction,
                lastActionTimestamp: member.lastActionTimestamp,
                status: member.status,
                attacks: member.attacks,
                score: member.score,
                refreshedAt,
            })),
        )
        .onDuplicateKeyUpdate({
            set: {
                name: sql`values(name)`,
                level: sql`values(level)`,
                lastAction: sql`values(last_action)`,
                lastActionTimestamp: sql`values(last_action_timestamp)`,
                status: sql`values(status)`,
                attacks: sql`values(attacks)`,
                score: sql`values(score)`,
                refreshedAt: sql`values(refreshed_at)`,
            },
        });
}

async function completeRefresh(teamId: number, startedAt: Date): Promise<void> {
    await db
        .delete(members)
        .where(and(eq(members.teamId, teamId), lt(members.refreshedAt, startedAt)));
    await db
        .update(sync)
        .set({ nextOffset: 0, refreshStartedAt: null, refreshedAt: new Date() })
        .where(eq(sync.teamId, teamId));

    for (const handler of handlers) {
        try {
            await handler(teamId);
        } catch (error) {
            console.warn(`${LOG_PREFIX} refresh handler failed for team ${teamId}:`, error);
        }
    }
}

function reportFailure(message: string): void {
    if (message === lastFailure) return;
    lastFailure = message;
    console.warn(`${LOG_PREFIX} ${message}`);
}

function reportError(error: unknown): void {
    reportFailure(error instanceof Error ? error.message : String(error));
}

export type KnownRoster = {
    teamId: number;
    members: { userId: number; name: string }[];
};

export async function getKnownRoster(teamName: string): Promise<KnownRoster | null> {
    const [team] = await db
        .select({ teamId: snapshots.teamId })
        .from(snapshots)
        .where(sql`lower(${snapshots.name}) = ${teamName.toLowerCase()}`)
        .orderBy(desc(snapshots.observedAt))
        .limit(1);
    if (!team) return null;

    const roster = await db
        .select({ userId: members.userId, name: members.name })
        .from(members)
        .where(eq(members.teamId, team.teamId));
    return { teamId: team.teamId, members: roster };
}
