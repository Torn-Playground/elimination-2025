import { createRequire } from "node:module";
import path from "node:path";
import { PassThrough } from "node:stream";
import { and, asc, desc, eq, sql } from "drizzle-orm";
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
};
const BG_COLOR = "#1e1f22";
const PLOT_COLOR = "#17181b";
const GRID_COLOR = "rgba(255, 255, 255, 0.06)";
const BORDER_COLOR = "rgba(255, 255, 255, 0.14)";
const TEXT_COLOR = "#b3bac2";
const TEXT_STRONG = "#e6e9ee";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type ActivityStat = "score" | "wins" | "losses";
export const ACTIVITY_STATS: ActivityStat[] = ["score", "wins", "losses"];

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

function statColumn(stat: ActivityStat) {
    switch (stat) {
        case "score":
            return snapshots.score;
        case "wins":
            return snapshots.wins;
        case "losses":
            return snapshots.losses;
    }
}

function statLabel(stat: ActivityStat): string {
    return `${stat[0].toUpperCase()}${stat.slice(1)}`;
}

export function formatNumber(value: number): string {
    return value.toLocaleString("en-US");
}

export function listTrackedTeams(): string[] {
    const rows = db
        .select({
            name: snapshots.name,
            last: sql<number>`max(${snapshots.observedAt})`,
        })
        .from(snapshots)
        .groupBy(sql`lower(${snapshots.name})`)
        .orderBy(desc(sql`max(${snapshots.observedAt})`))
        .all();
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
export async function getActivityChart(
    teamName: string,
    stat: ActivityStat,
): Promise<ActivityChartResult | null> {
    const resolved = db
        .select({ teamId: snapshots.teamId, name: snapshots.name })
        .from(snapshots)
        .where(sql`lower(${snapshots.name}) = ${teamName.toLowerCase()}`)
        .orderBy(desc(snapshots.observedAt))
        .limit(1)
        .get();
    if (!resolved) return null;

    const column = sql<number>`${statColumn(stat)}`;
    const rows = db
        .select({ t: snapshots.observedAt, v: column })
        .from(snapshots)
        .where(eq(snapshots.teamId, resolved.teamId))
        .orderBy(asc(snapshots.observedAt))
        .all();
    if (rows.length === 0) return null;

    const first = rows[0];
    const last = rows[rows.length - 1];
    const to = last.t.getTime();

    const cached = db
        .select()
        .from(cacheTable)
        .where(and(eq(cacheTable.teamId, resolved.teamId), eq(cacheTable.stat, stat)))
        .get();
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
    db.insert(cacheTable)
        .values({ teamId: resolved.teamId, stat, lastObservedAt, png })
        .onConflictDoUpdate({
            target: [cacheTable.teamId, cacheTable.stat],
            set: { lastObservedAt, png },
        })
        .run();

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

function xTickPositions(from: number, to: number): number[] {
    if (from >= to) return [MARGIN_LEFT + PLOT_WIDTH / 2];
    const count = Math.min(6, Math.max(2, Math.floor(PLOT_WIDTH / 130)));
    const positions: number[] = [];
    for (let i = 0; i < count; i++) {
        positions.push(MARGIN_LEFT + PLOT_WIDTH * (i / (count - 1)));
    }
    return positions;
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
    for (const x of xTickPositions(options.from, options.to)) {
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

    const xPositions = xTickPositions(options.from, options.to);
    const labelEvery = Math.max(1, Math.ceil(xPositions.length / 6));
    for (let i = 0; i < xPositions.length; i += labelEvery) {
        const x = xPositions[i];
        const t = span <= 0 ? options.from : options.from + span * (i / (xPositions.length - 1));
        drawLabel(
            ctx,
            timeLabel(t, span),
            x,
            MARGIN_TOP + PLOT_HEIGHT + 20,
            13,
            TEXT_COLOR,
            "center",
            "middle",
        );
    }

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
