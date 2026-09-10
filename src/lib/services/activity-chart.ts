import { createRequire } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import * as PImage from "pureimage";
import { db } from "../db";
import {
    activityChartCache as cacheTable,
    eliminationTeamSnapshots as snapshots,
} from "../db/schema";

const appRequire = createRequire(path.join(process.cwd(), "package.json"));
const FONT_FILE = appRequire.resolve("dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
const FONT_FAMILY = "DejaVuSans";

const WIDTH = 900;
const HEIGHT = 460;
const MARGIN_LEFT = 84;
const MARGIN_RIGHT = 30;
const MARGIN_TOP = 82;
const MARGIN_BOTTOM = 62;
const PLOT_WIDTH = WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const PLOT_HEIGHT = HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

const MAX_POINTS = 1200;
const COLORS: Record<ActivityStat, string> = {
    score: "#7483f5",
    wins: "#4bc47e",
    losses: "#ec5353",
    participants: "#ece953",
    lives: "#c153ec",
};

// Cache rows for the all-teams chart live under this synthetic team id
const ALL_TEAMS_TEAM_ID = -1;

const TEAM_PALETTE = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#aec7e8",
    "#ffbb78",
    "#98df8a",
    "#ff9896",
    "#c5b0d5",
    "#c49c94",
    "#f7b6d2",
    "#c7c7c7",
    "#dbdb8d",
    "#9edae5",
];
const BG_COLOR = "#1e1f22";
const PLOT_COLOR = "#17181b";
const GRID_COLOR = "rgba(255, 255, 255, 0.06)";
const BORDER_COLOR = "rgba(255, 255, 255, 0.14)";
const TEXT_COLOR = "#b3bac2";
const TEXT_STRONG = "#e6e9ee";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ActivityStat = "score" | "wins" | "losses" | "participants" | "lives";

type SeriesPoint = { t: number; v: number };

export type ActivityChartResult = {
    png: Buffer;
    cached: boolean;
    stat: ActivityStat;
    resolvedName: string;
    count: number;
    from: number;
    to: number;
    firstValue: number;
    lastValue: number;
};

export type AllTeamsActivityChartResult = {
    png: Buffer;
    cached: boolean;
    stat: ActivityStat;
    teamCount: number;
    eliminatedCount: number;
    pointCount: number;
};

type SnapshotRow = {
    teamId: number;
    name: string;
    eliminated: boolean;
    t: Date;
    v: number;
};

type TeamSeries = {
    name: string;
    points: SeriesPoint[];
    dot: boolean;
    color: string;
};

export function buildTeamSeries(rows: SnapshotRow[]): {
    series: TeamSeries[];
    maxValue: number;
    from: number;
    to: number;
} {
    const byTeam = new Map<number, { name: string; points: SeriesPoint[] }>();
    const stopped = new Set<number>();
    let maxValue = 0;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;

    for (const row of rows) {
        if (stopped.has(row.teamId)) continue;
        let team = byTeam.get(row.teamId);
        if (!team) {
            team = { name: row.name, points: [] };
            byTeam.set(row.teamId, team);
        }
        team.name = row.name;
        const t = row.t.getTime();
        team.points.push({ t, v: row.v });
        if (row.v > maxValue) maxValue = row.v;
        if (t < from) from = t;
        if (t > to) to = t;
        if (row.eliminated) stopped.add(row.teamId);
    }

    // Map insertion order follows the ascending teamId row order, so palette indexes are stable.
    const series = [...byTeam.values()].map((team, index) => ({
        name: team.name,
        points: sampleSeries(team.points),
        dot: team.points.length <= 90,
        color: TEAM_PALETTE[index % TEAM_PALETTE.length],
    }));
    return { series, maxValue, from, to };
}

function statColumn(stat: ActivityStat) {
    switch (stat) {
        case "score":
            return snapshots.score;
        case "wins":
            return snapshots.wins;
        case "losses":
            return snapshots.losses;
        case "participants":
            return snapshots.participants;
        case "lives":
            return snapshots.lives;
    }
}

function statLabel(stat: ActivityStat): string {
    return `${stat[0].toUpperCase()}${stat.slice(1)}`;
}

export function formatNumber(value: number): string {
    return value.toLocaleString("en-US");
}

export async function listTrackedTeams(): Promise<string[]> {
    const rows = await db
        .select({
            name: snapshots.name,
            last: sql<number>`max(${snapshots.observedAt})`,
        })
        .from(snapshots)
        .groupBy(sql`lower(${snapshots.name})`)
        .orderBy(desc(sql`max(${snapshots.observedAt})`));
    return rows.map((row) => row.name);
}

function sampleSeries(points: SeriesPoint[]): SeriesPoint[] {
    if (points.length <= MAX_POINTS) return points;
    const step = (points.length - 1) / (MAX_POINTS - 1);
    const sampled: SeriesPoint[] = [];
    for (let i = 0; i < MAX_POINTS - 1; i++) {
        sampled.push(points[Math.round(i * step)]);
    }
    sampled.push(points[points.length - 1]);
    return sampled;
}

// Render the chart for <team> and cache the PNG keyed by (team, stat). A new snapshot
// for the team moves last_observed_at, which makes any stored image stale.
// A <since> window bypasses the cache: the cached image is keyed without the window.
export async function getActivityChart(
    teamName: string,
    stat: ActivityStat,
    since?: Date,
): Promise<ActivityChartResult | null> {
    const [resolved] = await db
        .select({ teamId: snapshots.teamId, name: snapshots.name })
        .from(snapshots)
        .where(sql`lower(${snapshots.name}) = ${teamName.toLowerCase()}`)
        .orderBy(desc(snapshots.observedAt))
        .limit(1);
    if (!resolved) return null;

    const column = sql<number>`${statColumn(stat)}`;
    const rows = await db
        .select({ t: snapshots.observedAt, v: column })
        .from(snapshots)
        .where(
            since
                ? and(eq(snapshots.teamId, resolved.teamId), gte(snapshots.observedAt, since))
                : eq(snapshots.teamId, resolved.teamId),
        )
        .orderBy(asc(snapshots.observedAt));
    if (rows.length === 0) return null;

    const first = rows[0];
    const last = rows[rows.length - 1];
    const to = last.t.getTime();

    if (!since) {
        const [cached] = await db
            .select()
            .from(cacheTable)
            .where(and(eq(cacheTable.teamId, resolved.teamId), eq(cacheTable.stat, stat)))
            .limit(1);
        if (cached && cached.lastObservedAt.getTime() === to) {
            return {
                png: Buffer.from(cached.png as Uint8Array),
                cached: true,
                stat,
                resolvedName: resolved.name,
                count: rows.length,
                from: first.t.getTime(),
                to,
                firstValue: first.v,
                lastValue: last.v,
            };
        }
    }

    let maxValue = 0;
    const points: SeriesPoint[] = rows.map((row) => {
        const v = row.v;
        if (v > maxValue) maxValue = v;
        return { t: row.t.getTime(), v };
    });

    await ensureFont();
    const png = await renderActivityChart({
        name: resolved.name,
        stat,
        points: sampleSeries(points),
        maxValue,
        count: rows.length,
        from: first.t.getTime(),
        to,
    });

    const lastObservedAt = new Date(to);
    if (!since) {
        await db
            .insert(cacheTable)
            .values({ teamId: resolved.teamId, stat, lastObservedAt, png })
            .onDuplicateKeyUpdate({
                set: { lastObservedAt, png },
            });
    }

    return {
        png,
        cached: false,
        stat,
        resolvedName: resolved.name,
        count: rows.length,
        from: first.t.getTime(),
        to,
        firstValue: first.v,
        lastValue: last.v,
    };
}

// A <since> window bypasses the cache: the cached image is keyed without the window.
export async function getAllTeamsActivityChart(
    stat: ActivityStat,
    since?: Date,
): Promise<AllTeamsActivityChartResult | null> {
    const column = sql<number>`${statColumn(stat)}`;
    const window = since ? gte(snapshots.observedAt, since) : undefined;

    const [agg] = await db
        .select({
            pointCount: sql<number>`count(*)`,
            teamCount: sql<number>`count(distinct ${snapshots.teamId})`,
            eliminatedCount: sql<number>`count(distinct if(${snapshots.eliminated}, ${snapshots.teamId}, null))`,
        })
        .from(snapshots)
        .where(window);
    if (!agg || agg.pointCount === 0) return null;

    let latestObservedAt: Date | null = null;
    let cachedPng: Buffer | null = null;
    if (!since) {
        // Select the column itself (not an aggregate) so drizzle decodes it into a Date.
        const [latestRow] = await db
            .select({ t: snapshots.observedAt })
            .from(snapshots)
            .orderBy(desc(snapshots.observedAt))
            .limit(1);
        latestObservedAt = latestRow.t;

        const [cached] = await db
            .select()
            .from(cacheTable)
            .where(and(eq(cacheTable.teamId, ALL_TEAMS_TEAM_ID), eq(cacheTable.stat, stat)))
            .limit(1);
        if (cached && cached.lastObservedAt.getTime() === latestObservedAt.getTime()) {
            cachedPng = Buffer.from(cached.png as Uint8Array);
        }
    }
    if (cachedPng) {
        return {
            png: cachedPng,
            cached: true,
            stat,
            teamCount: agg.teamCount,
            eliminatedCount: agg.eliminatedCount,
            pointCount: agg.pointCount,
        };
    }

    const rows = await db
        .select({
            teamId: snapshots.teamId,
            name: snapshots.name,
            eliminated: snapshots.eliminated,
            t: snapshots.observedAt,
            v: column,
        })
        .from(snapshots)
        .where(window)
        .orderBy(asc(snapshots.teamId), asc(snapshots.observedAt));

    const { series, maxValue, from, to } = buildTeamSeries(rows);
    if (series.length === 0) return null;

    await ensureFont();
    const png = await renderAllTeamsChart({
        stat,
        series,
        maxValue,
        pointCount: agg.pointCount,
        teamCount: agg.teamCount,
        from,
        to,
    });

    if (!since && latestObservedAt) {
        await db
            .insert(cacheTable)
            .values({
                teamId: ALL_TEAMS_TEAM_ID,
                stat,
                lastObservedAt: latestObservedAt,
                png,
            })
            .onDuplicateKeyUpdate({
                set: { lastObservedAt: latestObservedAt, png },
            });
    }

    return {
        png,
        cached: false,
        stat,
        teamCount: agg.teamCount,
        eliminatedCount: agg.eliminatedCount,
        pointCount: agg.pointCount,
    };
}

let fontPromise: Promise<void> | null = null;

function ensureFont(): Promise<void> {
    if (!fontPromise) {
        const font = PImage.registerFont(FONT_FILE, FONT_FAMILY);
        fontPromise = font.load().catch((error: unknown) => {
            fontPromise = null;
            throw error;
        });
    }
    return fontPromise;
}

function encodePng(image: PImage.Bitmap): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const stream = new PassThrough();
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: Buffer) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
        PImage.encodePNGToStream(image, stream).catch(reject);
    });
}

function drawLabel(
    ctx: PImage.Context,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: "left" | "center" | "right" = "left",
    baseline: "alphabetic" | "middle" | "top" = "alphabetic",
): void {
    ctx.font = `${size}px ${FONT_FAMILY}`;
    ctx.fillStyle = color;
    ctx.textBaseline = baseline;
    const textX =
        align === "center"
            ? x - ctx.measureText(text).width / 2
            : align === "right"
              ? x - ctx.measureText(text).width
              : x;
    ctx.fillText(text, textX, y);
}

const AXIS_LABEL_SIZE = 13;
const UTC_LABEL_GAP = 6;

// Draw time labels, skipping any whose box would collide with the right-aligned "UTC" marker.
function drawTimeLabels(
    ctx: PImage.Context,
    times: number[],
    xOf: (t: number) => number,
    span: number,
): void {
    const y = MARGIN_TOP + PLOT_HEIGHT + 20;
    ctx.font = `${AXIS_LABEL_SIZE}px ${FONT_FAMILY}`;
    const utcLeft = WIDTH - MARGIN_RIGHT - ctx.measureText("UTC").width;
    for (const t of times) {
        const text = timeLabel(t, span);
        const halfWidth = ctx.measureText(text).width / 2;
        if (xOf(t) + halfWidth > utcLeft - UTC_LABEL_GAP) continue;
        drawLabel(ctx, text, xOf(t), y, AXIS_LABEL_SIZE, TEXT_COLOR, "center", "middle");
    }
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function timeLabel(timestamp: number, span: number): string {
    const date = new Date(timestamp);
    const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
    if (span >= 24 * 60 * 60 * 1000) {
        return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()} ${time}`;
    }
    return time;
}

function compactValue(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
    return String(value);
}

function trimZeroes(formatted: string): string {
    return formatted.replace(/\.0$/, "");
}

function niceStep(raw: number): number {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    const normalized = raw / magnitude;
    const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return Math.max(1, step * magnitude);
}

function yTicks(maxValue: number): { top: number; ticks: number[] } {
    if (maxValue <= 0) return { top: 1, ticks: [0, 1] };
    const step = niceStep(maxValue / 5);
    const top = Math.ceil(maxValue / step) * step;
    const ticks: number[] = [];
    for (let value = 0; value <= top + 1e-6; value += step) {
        ticks.push(Math.round(value));
    }
    return { top, ticks };
}

// Steps that keep labels on :00/:15/:30/:45: all divide a day, or are whole days.
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const X_TICK_STEPS_MS = [
    15 * 60_000,
    30 * 60_000,
    HOUR,
    2 * HOUR,
    3 * HOUR,
    4 * HOUR,
    6 * HOUR,
    12 * HOUR,
    DAY,
    2 * DAY,
    7 * DAY,
    14 * DAY,
    30 * DAY,
];

// Snapped to the step grid (epoch is midnight UTC), so labels land on quarter-hours.
function xTickTimes(from: number, to: number): number[] {
    if (from >= to) return [from];
    const span = to - from;
    const target = 6;
    const step =
        X_TICK_STEPS_MS.find((candidate) => span / candidate <= target) ??
        Math.ceil(span / target / DAY) * DAY;
    const ticks: number[] = [];
    for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
        ticks.push(t);
    }
    return ticks;
}

async function renderActivityChart(options: {
    name: string;
    stat: ActivityStat;
    points: SeriesPoint[];
    maxValue: number;
    count: number;
    from: number;
    to: number;
}): Promise<Buffer> {
    const image = PImage.make(WIDTH, HEIGHT);
    const ctx = image.getContext("2d") as PImage.Context;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.fillStyle = PLOT_COLOR;
    ctx.fillRect(MARGIN_LEFT, MARGIN_TOP, PLOT_WIDTH, PLOT_HEIGHT);

    drawLabel(ctx, options.name, MARGIN_LEFT, 34, 22, TEXT_STRONG);
    drawLabel(ctx, `${statLabel(options.stat)} history`, MARGIN_LEFT, 60, 14, TEXT_COLOR);
    drawLabel(
        ctx,
        `${formatNumber(options.count)} data points`,
        WIDTH - MARGIN_RIGHT,
        60,
        13,
        TEXT_COLOR,
        "right",
    );

    const accent = COLORS[options.stat];
    const { top, ticks } = yTicks(options.maxValue);
    const span = options.to - options.from;
    const xOf = (t: number): number => {
        if (span <= 0) return MARGIN_LEFT + PLOT_WIDTH / 2;
        return MARGIN_LEFT + (PLOT_WIDTH * (t - options.from)) / span;
    };
    const yOf = (value: number): number => MARGIN_TOP + PLOT_HEIGHT * (1 - value / top);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const tick of ticks) {
        const y = yOf(tick);
        ctx.moveTo(MARGIN_LEFT, y);
        ctx.lineTo(MARGIN_LEFT + PLOT_WIDTH, y);
    }
    for (const t of xTickTimes(options.from, options.to)) {
        const x = xOf(t);
        ctx.moveTo(x, MARGIN_TOP);
        ctx.lineTo(x, MARGIN_TOP + PLOT_HEIGHT);
    }
    ctx.stroke();

    ctx.strokeStyle = BORDER_COLOR;
    ctx.strokeRect(MARGIN_LEFT, MARGIN_TOP, PLOT_WIDTH, PLOT_HEIGHT);

    for (const tick of ticks) {
        const label = trimZeroes(compactValue(tick));
        drawLabel(ctx, label, MARGIN_LEFT - 12, yOf(tick), 13, TEXT_COLOR, "right", "middle");
    }

    drawTimeLabels(ctx, xTickTimes(options.from, options.to), xOf, span);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (const [i, point] of options.points.entries()) {
        const x = xOf(point.t);
        const y = yOf(point.v);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    if (options.points.length <= 90) {
        ctx.fillStyle = accent;
        for (const point of options.points) {
            ctx.beginPath();
            ctx.arc(xOf(point.t), yOf(point.v), 2.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    const lastPoint = options.points[options.points.length - 1];
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(xOf(lastPoint.t), yOf(lastPoint.v), 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(xOf(lastPoint.t), yOf(lastPoint.v), 1.8, 0, Math.PI * 2);
    ctx.fill();

    drawLabel(
        ctx,
        "UTC",
        WIDTH - MARGIN_RIGHT,
        MARGIN_TOP + PLOT_HEIGHT + 20,
        13,
        TEXT_COLOR,
        "right",
        "middle",
    );

    return encodePng(image);
}

const LEGEND_COLUMNS = 2;
const LEGEND_ROW_HEIGHT = 17;
const LEGEND_SWATCH = 11;
const LEGEND_TOP = HEIGHT - 16;

function truncateLabel(text: string, maxChars: number): string {
    return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

async function renderAllTeamsChart(options: {
    stat: ActivityStat;
    series: { name: string; color: string; points: SeriesPoint[]; dot: boolean }[];
    maxValue: number;
    pointCount: number;
    teamCount: number;
    from: number;
    to: number;
}): Promise<Buffer> {
    const legendRows = Math.ceil(options.series.length / LEGEND_COLUMNS);
    const height = LEGEND_TOP + legendRows * LEGEND_ROW_HEIGHT + 10;
    const image = PImage.make(WIDTH, height);
    const ctx = image.getContext("2d") as PImage.Context;

    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, WIDTH, height);

    ctx.fillStyle = PLOT_COLOR;
    ctx.fillRect(MARGIN_LEFT, MARGIN_TOP, PLOT_WIDTH, PLOT_HEIGHT);

    drawLabel(ctx, "All teams", MARGIN_LEFT, 34, 22, TEXT_STRONG);
    drawLabel(
        ctx,
        `${statLabel(options.stat)} history — each line stops at that team's elimination`,
        MARGIN_LEFT,
        60,
        14,
        TEXT_COLOR,
    );
    drawLabel(
        ctx,
        `${options.teamCount} teams · ${formatNumber(options.pointCount)} data points`,
        WIDTH - MARGIN_RIGHT,
        60,
        13,
        TEXT_COLOR,
        "right",
    );

    const { top, ticks } = yTicks(options.maxValue);
    const span = options.to - options.from;
    const xOf = (t: number): number => {
        if (span <= 0) return MARGIN_LEFT + PLOT_WIDTH / 2;
        return MARGIN_LEFT + (PLOT_WIDTH * (t - options.from)) / span;
    };
    const yOf = (value: number): number => MARGIN_TOP + PLOT_HEIGHT * (1 - value / top);

    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const tick of ticks) {
        const y = yOf(tick);
        ctx.moveTo(MARGIN_LEFT, y);
        ctx.lineTo(MARGIN_LEFT + PLOT_WIDTH, y);
    }
    for (const t of xTickTimes(options.from, options.to)) {
        const x = xOf(t);
        ctx.moveTo(x, MARGIN_TOP);
        ctx.lineTo(x, MARGIN_TOP + PLOT_HEIGHT);
    }
    ctx.stroke();

    ctx.strokeStyle = BORDER_COLOR;
    ctx.strokeRect(MARGIN_LEFT, MARGIN_TOP, PLOT_WIDTH, PLOT_HEIGHT);

    for (const tick of ticks) {
        const label = trimZeroes(compactValue(tick));
        drawLabel(ctx, label, MARGIN_LEFT - 12, yOf(tick), 13, TEXT_COLOR, "right", "middle");
    }

    drawTimeLabels(ctx, xTickTimes(options.from, options.to), xOf, span);

    for (const team of options.series) {
        ctx.strokeStyle = team.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        for (const [i, point] of team.points.entries()) {
            const x = xOf(point.t);
            const y = yOf(point.v);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    for (const team of options.series) {
        if (!team.dot) continue;
        ctx.fillStyle = team.color;
        for (const point of team.points) {
            ctx.beginPath();
            ctx.arc(xOf(point.t), yOf(point.v), 2.4, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawLabel(
        ctx,
        "UTC",
        WIDTH - MARGIN_RIGHT,
        MARGIN_TOP + PLOT_HEIGHT + 20,
        13,
        TEXT_COLOR,
        "right",
        "middle",
    );

    const columnWidth = (PLOT_WIDTH - 16) / LEGEND_COLUMNS;
    const maxChars = Math.floor(columnWidth / 8);
    for (const [i, team] of options.series.entries()) {
        const column = i % LEGEND_COLUMNS;
        const row = Math.floor(i / LEGEND_COLUMNS);
        const x = MARGIN_LEFT + column * (columnWidth + 16);
        const y = LEGEND_TOP + row * LEGEND_ROW_HEIGHT;
        ctx.fillStyle = team.color;
        ctx.fillRect(x, y + 3, LEGEND_SWATCH, LEGEND_SWATCH);
        drawLabel(
            ctx,
            truncateLabel(team.name, maxChars),
            x + LEGEND_SWATCH + 7,
            y + LEGEND_ROW_HEIGHT / 2,
            13,
            TEXT_COLOR,
            "left",
            "middle",
        );
    }

    return encodePng(image);
}
