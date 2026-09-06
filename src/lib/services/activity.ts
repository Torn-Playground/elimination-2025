import { Cron } from "croner";
import { desc, eq } from "drizzle-orm";
import { ELIMINATION_CRON } from "../../config";
import { db } from "../db";
import { eliminationTeamSnapshots as snapshots } from "../db/schema";
import { type EliminationTeamStanding, getEliminationStandings } from "./torn";

type Snapshot = typeof snapshots.$inferSelect;

const LOG_PREFIX = "[activity]";

export function startActivityTracking(): void {
    let job: Cron;
    try {
        job = new Cron(
            ELIMINATION_CRON,
            { name: "elimination-activity", catch: reportError },
            () => void tick(),
        );
    } catch (error) {
        throw new Error(
            `Invalid ELIMINATION_CRON pattern '${ELIMINATION_CRON}': ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    console.info(
        `${LOG_PREFIX} started (cron '${ELIMINATION_CRON}', next run ${job.nextRun()?.toISOString() ?? "never"}).`,
    );
    void tick();
}

let running = false;
let lastFailure: string | null = null;

async function tick(): Promise<void> {
    if (running) return;
    running = true;
    try {
        const standings = await getEliminationStandings();
        if (standings === null) {
            reportFailure("no API keys stored; skipping");
            return;
        }
        if (lastFailure) {
            console.info(`${LOG_PREFIX} resumed.`);
            lastFailure = null;
        }
        recordChanges(standings);
    } catch (error) {
        reportFailure(error instanceof Error ? error.message : String(error));
    } finally {
        running = false;
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

function recordChanges(standings: EliminationTeamStanding[]): void {
    let changed = 0;
    const now = new Date();
    for (const team of standings) {
        const prev = db
            .select()
            .from(snapshots)
            .where(eq(snapshots.teamId, team.id))
            .orderBy(desc(snapshots.observedAt))
            .limit(1)
            .get();
        if (prev && sameStanding(prev, team)) continue;

        db.insert(snapshots)
            .values({
                teamId: team.id,
                name: team.name,
                participants: team.participants,
                position: team.position,
                score: team.score,
                lives: team.lives,
                wins: team.wins,
                losses: team.losses,
                eliminated: team.eliminated,
                eliminatedTimestamp: team.eliminatedTimestamp,
                observedAt: now,
            })
            .run();
        changed++;
    }
    if (changed > 0) {
        console.info(`${LOG_PREFIX} ${changed}/${standings.length} teams changed.`);
    }
}

function sameStanding(prev: Snapshot, current: EliminationTeamStanding): boolean {
    return (
        prev.name.toLowerCase() === current.name.toLowerCase() &&
        prev.participants === current.participants &&
        prev.position === current.position &&
        prev.score === current.score &&
        prev.lives === current.lives &&
        prev.wins === current.wins &&
        prev.losses === current.losses &&
        prev.eliminated === current.eliminated &&
        prev.eliminatedTimestamp === current.eliminatedTimestamp
    );
}
