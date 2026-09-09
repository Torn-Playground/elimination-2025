import path from "node:path";
import { container } from "@sapphire/framework";
import type { Client, Guild } from "discord.js";
import {
    DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET,
    OWNER_ID,
    WEB_PORT,
    WEB_PUBLIC_URL,
} from "../config";
import {
    claimSlot,
    getPushSettings,
    listSchedule,
    type PushSettings,
    releaseSlot,
    type ScheduleEntry,
} from "../lib/services/push";
import {
    createWebSession,
    deleteWebSession,
    getWebSession,
    type WebUser,
} from "../lib/services/web-sessions";

const WEB_ROOT = path.resolve(process.cwd(), "web");
const SESSION_COOKIE = "push_sid";
const SESSION_MAX_AGE = 30 * 86_400;

const MIME: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
};

type RoleInfo = { isMember: boolean; isAdmin: boolean; hasRole: boolean };

async function memberOf(
    client: Client,
    guildId: string | null,
    userId: string,
    settings: PushSettings,
): Promise<RoleInfo> {
    if (userId === OWNER_ID) return { isMember: true, isAdmin: true, hasRole: true };
    if (!guildId) return { isMember: false, isAdmin: false, hasRole: false };
    const guild = await fetchGuild(client, guildId);
    if (!guild) return { isMember: false, isAdmin: false, hasRole: false };
    try {
        const member = await guild.members.fetch(userId);
        return {
            isMember: true,
            isAdmin: settings.adminRoleIds.some((id) => member.roles.cache.has(id)),
            hasRole: settings.roleId !== null && member.roles.cache.has(settings.roleId),
        };
    } catch {
        return { isMember: false, isAdmin: false, hasRole: false };
    }
}

/**
 * Calendar access: admins and the owner always pass. When a push role is
 * configured, only holders of that role may use the calendar; otherwise any
 * server member may.
 */
function canAccess(userId: string, info: RoleInfo, settings: PushSettings): boolean {
    if (userId === OWNER_ID || info.isAdmin) return true;
    if (!settings.roleId) return info.isMember;
    return info.hasRole;
}

const guildCache = new Map<string, { guild: Guild | null; at: number }>();
const GUILD_CACHE_MS = 5 * 60_000;

async function fetchGuild(client: Client, guildId: string): Promise<Guild | null> {
    const cached = guildCache.get(guildId);
    if (cached && Date.now() - cached.at < GUILD_CACHE_MS) return cached.guild;
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    guildCache.set(guildId, { guild, at: Date.now() });
    return guild;
}

const nameCache = new Map<string, { name: string; at: number }>();
const NAME_CACHE_MS = 5 * 60_000;

async function resolveDisplayName(
    client: Client,
    guildId: string | null,
    user: WebUser,
): Promise<string> {
    const cached = nameCache.get(user.id);
    if (cached && Date.now() - cached.at < NAME_CACHE_MS) return cached.name;
    let name = user.username;
    if (guildId) {
        const guild = await fetchGuild(client, guildId);
        try {
            const member = guild ? await guild.members.fetch(user.id) : null;
            if (member) name = member.displayName;
        } catch {
            // member left the guild; fall back to their stored username
        }
    }
    nameCache.set(user.id, { name, at: Date.now() });
    return name;
}

function clientOf(): Client {
    return container.client as Client;
}

// ---- responses & request helpers ----

function json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });
}

function parseCookies(header: string | null): Record<string, string> {
    const out: Record<string, string> = {};
    if (!header) return out;
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
    }
    return out;
}

function baseUrl(req: Request): string {
    if (WEB_PUBLIC_URL) return WEB_PUBLIC_URL.replace(/\/$/, "");
    const proto = req.headers.get("x-forwarded-proto") ?? "http";
    return `${proto}://${req.headers.get("host")}`;
}

function isSecure(req: Request): boolean {
    return baseUrl(req).startsWith("https");
}

function sessionCookie(token: string, secure: boolean): string {
    return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE}${secure ? "; Secure" : ""}`;
}

// ---- OAuth ----

function oauthConfigured(): boolean {
    return Boolean(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET);
}

async function handleLogin(req: Request): Promise<Response> {
    if (!oauthConfigured()) {
        return json(
            {
                error: "Discord OAuth is not configured (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).",
            },
            503,
        );
    }
    const redirectUri = `${baseUrl(req)}/api/auth/callback`;
    const url =
        `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&response_type=code&scope=identify`;
    return Response.redirect(url, 302);
}

async function handleCallback(req: Request): Promise<Response> {
    const code = new URL(req.url).searchParams.get("code");
    const clientId = DISCORD_CLIENT_ID;
    const clientSecret = DISCORD_CLIENT_SECRET;
    if (!code || !clientId || !clientSecret) {
        return Response.redirect(`${baseUrl(req)}/`, 302);
    }
    const redirectUri = `${baseUrl(req)}/api/auth/callback`;
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
        }),
    });
    const tokenBody = (await tokenRes.json().catch(() => null)) as {
        access_token?: string;
    } | null;
    if (!tokenRes.ok || !tokenBody?.access_token) {
        return json({ error: "Discord authorization failed." }, 401);
    }

    const userRes = await fetch("https://discord.com/api/users/@me", {
        headers: { authorization: `Bearer ${tokenBody.access_token}` },
    });
    const discordUser = (await userRes.json().catch(() => null)) as {
        id?: string;
        username?: string;
        avatar?: string;
    } | null;
    if (!userRes.ok || !discordUser?.id) {
        return json({ error: "Could not load your Discord profile." }, 401);
    }

    const user: WebUser = {
        id: discordUser.id,
        username: discordUser.username ?? "Unknown",
        avatar: discordUser.avatar ?? "",
    };
    const token = await createWebSession(user);
    const res = Response.redirect(`${baseUrl(req)}/`, 302);
    res.headers.set("set-cookie", sessionCookie(token, isSecure(req)));
    return res;
}

async function handleLogout(req: Request): Promise<Response> {
    const cookies = parseCookies(req.headers.get("cookie"));
    if (cookies[SESSION_COOKIE]) await deleteWebSession(cookies[SESSION_COOKIE]);
    const res = Response.redirect(`${baseUrl(req)}/`, 302);
    res.headers.set(
        "set-cookie",
        sessionCookie("", isSecure(req)).replace(/Max-Age=\d+/, "Max-Age=0"),
    );
    return res;
}

async function currentUser(req: Request): Promise<WebUser | null> {
    const cookies = parseCookies(req.headers.get("cookie"));
    const token = cookies[SESSION_COOKIE];
    return token ? getWebSession(token) : null;
}

// ---- API ----

function avatarUrl(user: WebUser): string {
    if (!user.avatar) return "";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
}

async function handleMe(req: Request): Promise<Response> {
    const user = await currentUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const client = clientOf();
    const settings = await getPushSettings();
    const info = await memberOf(client, settings.guildId, user.id, settings);
    const displayName = await resolveDisplayName(client, settings.guildId, user);
    return json({
        me: {
            id: user.id,
            username: user.username,
            displayName,
            avatar: avatarUrl(user),
            isAdmin: info.isAdmin,
            isOwner: user.id === OWNER_ID,
            isMember: info.isMember,
            access: canAccess(user.id, info, settings),
        },
    });
}

async function handleState(req: Request): Promise<Response> {
    const user = await currentUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const client = clientOf();
    const settings = await getPushSettings();
    const guildId = settings.guildId;
    const info = await memberOf(client, guildId, user.id, settings);
    if (!canAccess(user.id, info, settings)) {
        return json(
            {
                error: "forbidden",
                message: "This calendar is restricted to members with the push role.",
            },
            403,
        );
    }
    const displayName = await resolveDisplayName(client, guildId, user);

    const schedule = await listSchedule();
    const names = new Map<string, string | null>();
    const claimants = new Set(
        schedule.map((entry) => entry.userId).filter((id): id is string => id !== null),
    );
    for (const userId of claimants) {
        const name = await resolveDisplayName(client, guildId, {
            id: userId,
            username: userId,
            avatar: "",
        });
        names.set(userId, name === userId ? null : name);
    }

    const guild = guildId ? await fetchGuild(client, guildId) : null;
    return json({
        window:
            settings.start && settings.end
                ? { start: settings.start.toISOString(), end: settings.end.toISOString() }
                : null,
        channelConfigured: settings.channelId !== null,
        guildId,
        guildName: guild?.name ?? null,
        now: Date.now(),
        me: {
            id: user.id,
            username: user.username,
            displayName,
            avatar: avatarUrl(user),
            isAdmin: info.isAdmin,
            isOwner: user.id === OWNER_ID,
            isMember: info.isMember,
            access: true,
        },
        slots: schedule.map((entry: ScheduleEntry) => ({
            start: entry.start.toISOString(),
            userId: entry.userId,
            name: entry.userId ? (names.get(entry.userId) ?? null) : null,
        })),
    });
}

const CLAIM_ERRORS: Record<string, string> = {
    taken: "That slot was just claimed by someone else.",
    locked: "That slot has already started.",
    "no-window": "That slot is outside the configured window.",
};

async function handleSlot(req: Request): Promise<Response> {
    const user = await currentUser(req);
    if (!user) return json({ error: "unauthorized" }, 401);
    const client = clientOf();
    const settings = await getPushSettings();
    const info = await memberOf(client, settings.guildId, user.id, settings);
    if (!canAccess(user.id, info, settings)) {
        return json(
            {
                error: "forbidden",
                message: "This calendar is restricted to members with the push role.",
            },
            403,
        );
    }

    const body = (await req.json().catch(() => null)) as { start?: string; action?: string } | null;
    const startMs = body?.start ? Date.parse(body.start) : NaN;
    if (body?.action !== "claim" && body?.action !== "release") {
        return json({ error: "invalid-request" }, 400);
    }
    if (Number.isNaN(startMs)) return json({ error: "invalid-request" }, 400);
    const start = new Date(startMs);

    if (body.action === "claim") {
        const result = await claimSlot(start, user.id);
        if (result !== "ok") {
            const status = result === "taken" ? 409 : result === "locked" ? 409 : 400;
            return json({ error: result, message: CLAIM_ERRORS[result] }, status);
        }
        return json({ ok: true });
    }

    // release: self or admin force
    if (user.id === OWNER_ID) {
        const result = await releaseSlot(start, user.id, true);
        if (result !== "ok") return json({ error: result }, 400);
        return json({ ok: true });
    }
    const slot = scheduleEntryAt(await listSchedule(), start);
    const force = info.isAdmin;
    if (!slot?.userId) return json({ error: "free" }, 400);
    if (slot.userId !== user.id && !force) {
        return json({ error: "not-owner" }, 403);
    }
    const result = await releaseSlot(start, slot.userId, force);
    if (result !== "ok") return json({ error: result }, 400);
    return json({ ok: true });
}

function scheduleEntryAt(schedule: ScheduleEntry[], start: Date): ScheduleEntry | null {
    const time = start.getTime();
    return schedule.find((entry) => entry.start.getTime() === time) ?? null;
}

// ---- static files ----

async function handleStatic(urlPath: string): Promise<Response> {
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const filePath = path.resolve(WEB_ROOT, rel);
    if (!filePath.startsWith(WEB_ROOT)) return json({ error: "not found" }, 404);
    const file = Bun.file(filePath);
    if (!(await file.exists())) return json({ error: "not found" }, 404);
    const ext = path.extname(filePath).toLowerCase();
    return new Response(file, {
        headers: {
            "content-type": MIME[ext] ?? "application/octet-stream",
            "cache-control": "no-cache",
        },
    });
}

// ---- server ----

export function startWebServer(): void {
    const server = Bun.serve({
        hostname: "0.0.0.0",
        port: WEB_PORT,
        async fetch(req) {
            const url = new URL(req.url);
            try {
                if (url.pathname === "/api/auth/login") return await handleLogin(req);
                if (url.pathname === "/api/auth/callback") return await handleCallback(req);
                if (url.pathname === "/api/auth/logout") return await handleLogout(req);
                if (url.pathname === "/api/me") return await handleMe(req);
                if (url.pathname === "/api/state") return await handleState(req);
                if (url.pathname === "/api/slot" && req.method === "POST")
                    return await handleSlot(req);
                if (url.pathname.startsWith("/api/")) return json({ error: "not found" }, 404);
                return await handleStatic(url.pathname);
            } catch (error) {
                console.error("[web] request failed:", error);
                return json({ error: "internal" }, 500);
            }
        },
    });
    console.info(`[web] listening on http://0.0.0.0:${server.port}`);
}
