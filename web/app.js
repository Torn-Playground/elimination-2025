const HOUR = 3600000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");

const state = {
    data: null,
    fetchedAt: 0,
    dayKey: null,
    filter: "all",
    tzLocal: false,
    adminMode: true,
};

function esc(value) {
    return String(value).replace(
        /[&<>"']/g,
        (ch) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[ch],
    );
}

function nowMs() {
    return (state.data ? state.data.now : Date.now()) + (Date.now() - state.fetchedAt);
}

function utcDayKey(ms) {
    return new Date(ms).toISOString().slice(0, 10);
}

function icon(name, cls = "text-[16px]") {
    return `<span class="material-symbols-outlined ${cls} align-middle">${name}</span>`;
}

function formatHour(ms, local) {
    const d = new Date(ms);
    const hour = local ? d.getHours() : d.getUTCHours();
    return `${String(hour).padStart(2, "0")}:00`;
}

function formatRangeLabel(startMs, endMs, local) {
    return `${formatHour(startMs, local)} – ${formatHour(endMs, local)}`;
}

function tzName() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function offsetLabel() {
    const off = -new Date().getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const abs = Math.abs(off);
    return `GMT${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

async function api(path, options) {
    const res = await fetch(path, options);
    if (res.status === 401) {
        renderLoggedOut();
        return null;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw Object.assign(new Error(body.message || body.error || "Request failed"), {
            status: res.status,
            code: body.error,
        });
    }
    return body;
}

function showToast(message, isError = false) {
    toastEl.innerHTML = `
        <div class="flex items-center gap-2.5 bg-surface-container-high text-on-surface px-4 py-3 rounded-xl border ${isError ? "border-error/40" : "border-outline-variant/30"} shadow-xl">
            ${icon(isError ? "error" : "check_circle", "text-[18px] text-secondary")}
            <span class="text-sm font-medium">${esc(message)}</span>
            <button data-action="dismiss-toast" class="text-on-surface-variant hover:text-on-surface">${icon("close", "text-[16px]")}</button>
        </div>`;
    toastEl.classList.remove("hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 6000);
}

function toastError(error) {
    showToast(error instanceof Error ? error.message : String(error), true);
}

// ---------------------------------------------------------------------------
// header + logged out
// ---------------------------------------------------------------------------

function renderLoggedOut() {
    document.title = "Grassmower — Push Calendar";
    app.innerHTML = `
        <header class="fixed top-0 left-0 right-0 z-50 h-16 bg-surface-container-low/95 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.35)]">
            <div class="max-w-7xl mx-auto w-full h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-space-md">
                ${logoBlock()}
                <button data-action="login" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-container hover:bg-inverse-primary text-on-primary-container text-sm font-bold transition-colors">
                    ${icon("login", "text-[18px]")} Login with Discord
                </button>
            </div>
        </header>
        <main class="min-h-screen flex items-center justify-center pt-16 px-4">
            <div class="bg-surface-container rounded-2xl shadow-lg border border-outline-variant/20 p-8 max-w-md text-center flex flex-col items-center gap-4">
                <div class="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-container via-primary-container to-secondary flex items-center justify-center shadow-md">${icon("agriculture", "text-[32px] text-white")}</div>
                <div>
                    <h1 class="font-headline-lg text-headline-lg font-bold">Push Calendar</h1>
                    <p class="text-on-surface-variant text-sm mt-1">Sign in with Discord to claim your push windows.</p>
                </div>
                <button data-action="login" class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-container hover:bg-inverse-primary text-on-primary-container font-bold text-sm transition-colors">
                    ${icon("login", "text-[18px]")} Continue with Discord
                </button>
            </div>
        </main>`;
}

function logoBlock() {
    return `
        <div class="flex items-center gap-space-sm">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-container via-primary-container to-secondary flex items-center justify-center text-on-primary shadow-md shrink-0">${icon("agriculture", "text-[20px] text-white")}</div>
            <div class="flex items-center gap-1.5">
                <span class="font-headline-sm text-headline-sm text-on-surface tracking-tight font-bold">Grassmower</span>
                <span class="font-label-sm text-[9px] px-1.5 py-0.5 rounded bg-secondary/15 text-secondary border border-secondary/30 font-semibold tracking-wide uppercase">Push</span>
            </div>
        </div>`;
}

function renderHeader(me) {
    const adminOver = me.isAdmin || me.isOwner;
    const pillState = state.adminMode ? "Active" : "Inactive";
    return `
        <header class="fixed top-0 left-0 right-0 z-50 h-16 bg-surface-container-low/95 backdrop-blur-md shadow-[0_1px_8px_rgba(0,0,0,0.35)]">
            <div class="max-w-7xl mx-auto w-full h-full px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-space-md">
                ${logoBlock()}
                ${
                    state.data.guildName
                        ? `<div class="hidden md:flex items-center gap-space-sm bg-surface-container px-space-md py-space-xs rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
                    <span class="w-2 h-2 rounded-full bg-secondary shrink-0 animate-pulse"></span>
                    <span class="font-label-md text-label-md text-on-surface truncate max-w-[160px] lg:max-w-[240px]">${esc(state.data.guildName)}</span>
                </div>`
                        : ""
                }
                <div class="flex items-center gap-space-md shrink-0">
                    ${
                        adminOver
                            ? `
                    <div class="hidden lg:flex items-center gap-space-xs px-space-sm py-space-xs rounded-full bg-surface-container-high text-secondary border border-secondary/20">
                        ${icon("shield", "text-[16px]")}
                        <span class="font-label-sm text-label-sm uppercase tracking-wider">Admin Override: ${pillState}</span>
                        <span class="w-1.5 h-1.5 rounded-full ${state.adminMode ? "bg-secondary" : "bg-outline"} ml-space-2xs"></span>
                    </div>`
                            : ""
                    }
                    <button data-action="toggle-tz" class="hidden sm:flex items-center gap-space-xs px-space-sm py-space-xs rounded-xl bg-surface-container hover:bg-surface-container-high hover:text-on-surface text-on-surface-variant transition-colors border border-outline-variant/30" title="Switch timezone">
                        ${icon("schedule", "text-[16px] text-secondary")}
                        <span class="font-time-display text-time-display">${state.tzLocal ? offsetLabel() : "UTC+00:00"}</span>
                        ${icon("swap_horiz", "text-[14px]")}
                    </button>
                    <div class="flex items-center gap-space-sm pl-space-xs">
                        <div class="relative flex items-center">
                            ${me.avatar ? `<img src="${esc(me.avatar)}" alt="" class="w-8 h-8 rounded-full ring-2 ring-secondary/50 object-cover"/>` : `<div class="w-8 h-8 rounded-full bg-primary-container text-white flex items-center justify-center font-bold text-xs ring-2 ring-secondary/50">${esc((me.displayName || me.username || "?").slice(0, 2).toUpperCase())}</div>`}
                            <span class="absolute bottom-0 right-0 w-2.5 h-2.5 bg-secondary rounded-full ring-2 ring-surface-container-low"></span>
                        </div>
                        <div class="hidden md:flex flex-col text-left">
                            <span class="font-label-md text-label-md text-on-surface">@${esc(me.displayName || me.username)}</span>
                        </div>
                        <button data-action="logout" aria-label="Log out" class="p-space-xs rounded-xl text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors" title="Log out">${icon("logout", "text-[18px]")}</button>
                    </div>
                </div>
            </div>
        </header>`;
}

// ---------------------------------------------------------------------------
// main content
// ---------------------------------------------------------------------------

function slotState(slot, me) {
    const start = Date.parse(slot.start);
    const end = start + HOUR;
    const now = nowMs();
    const mine = me && slot.userId === me.id;
    let kind;
    if (end <= now) kind = "past";
    else if (start <= now) kind = "live";
    else kind = "future";
    return { start, end, mine, kind, claimed: Boolean(slot.userId), name: slot.name };
}

function render() {
    const data = state.data;
    if (!data) return;
    document.title = "Grassmower — Push Calendar";
    const me = data.me;
    state.adminMode = state.adminMode && (me.isAdmin || me.isOwner);

    const slots = data.slots.map((slot) => {
        const s = slotState(slot, me);
        s.userId = slot.userId;
        return s;
    });

    const days = buildDays(slots);
    if (!state.dayKey || !days.some((d) => d.key === state.dayKey)) {
        const today = utcDayKey(nowMs());
        const sel = days.find((d) => d.key === today) ?? days[0];
        state.dayKey = sel ? sel.key : null;
    }

    app.innerHTML = `
        ${renderHeader(me)}
        <main class="relative w-full pt-20 px-4 sm:px-6 lg:px-8 bg-background min-h-screen">
            <div class="max-w-7xl mx-auto flex flex-col w-full pb-16 gap-8">
                ${data.window ? renderWindow(data, me, slots, days) : renderNoWindow(me)}
            </div>
        </main>`;
    attachCountdowns();
}

function renderNoWindow(me) {
    return `
        <div class="w-full bg-surface-container rounded-2xl shadow-lg border border-outline-variant/20 p-10 flex flex-col items-center gap-4 text-center mt-6">
            <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-container to-secondary/40 flex items-center justify-center">${icon("calendar_clock", "text-[28px] text-secondary")}</div>
            <div>
                <h1 class="font-headline-lg text-headline-lg font-bold">No push window configured yet</h1>
                <p class="text-on-surface-variant text-sm mt-1 max-w-md">
                    ${me.isOwner ? "Set the window with <code class='text-secondary'>/push window &lt;start&gt; &lt;end&gt;</code> — then the calendar will appear here." : "The organizer hasn't opened signups yet. Check back soon."}
                </p>
            </div>
        </div>`;
}

function renderWindow(data, me, slots, days) {
    const startMs = Date.parse(data.window.start);
    const endMs = Date.parse(data.window.end);
    const totalHours = slots.length;
    const claimed = slots.filter((s) => s.claimed).length;
    const pct = totalHours === 0 ? 0 : Math.round((claimed / totalHours) * 1000) / 10;
    const futureFree = slots.filter((s) => s.kind === "future" && !s.claimed).length;
    const activeDay = days.find((d) => d.key === state.dayKey) ?? days[0];
    const daySlots = (activeDay ? activeDay.slots : []).filter(filterSlot);

    const todayUTC = utcDayKey(nowMs());
    const gapDays = Math.max(1, Math.round((endMs - startMs) / HOUR / 24) || 1);
    const horizonTitle = `Campaign Horizon: ${utcShort(startMs)} – ${utcShort(endMs)}`;

    const memberNote = !me.isMember
        ? `
        <div class="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-xl border border-tertiary/30 text-xs text-tertiary font-medium">
            ${icon("info", "text-[15px]")} Join <strong>${esc(data.guildName ?? "the server")}</strong> on Discord to claim a slot.
        </div>`
        : "";

    return `
        <!-- Top banner -->
        <div class="w-full bg-surface-container rounded-2xl shadow-lg p-6 flex flex-col xl:flex-row items-start xl:items-center justify-between gap-6 border border-outline-variant/20">
            <div class="flex flex-wrap items-center gap-5">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-container to-secondary/40 flex items-center justify-center text-on-primary shadow-md border border-secondary/30 shrink-0">${icon("calendar_clock", "text-[30px] text-secondary")}</div>
                <div class="flex flex-col min-w-0">
                    <div class="flex flex-wrap items-center gap-3">
                        <span class="font-headline-sm text-lg text-on-surface font-bold tracking-tight">${horizonTitle}</span>
                        <span class="text-xs px-2.5 py-1 rounded-md bg-secondary-container text-on-secondary font-bold uppercase tracking-wider">${gapDays}-Day Window</span>
                        <span class="text-xs px-2.5 py-1 rounded-md bg-surface-container-high text-primary flex items-center gap-1 font-semibold">${icon("verified", "text-[14px]")} ${totalHours} Hours Total</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 text-on-surface-variant text-sm mt-1.5">
                        <span class="text-on-surface">Current User: <strong class="text-secondary font-semibold">@${esc(me.displayName || me.username)} (You)</strong></span>
                        <span class="text-outline">•</span>
                        ${me.isOwner ? '<span class="text-tertiary font-semibold uppercase tracking-wider text-xs">Owner</span>' : me.isAdmin ? '<span class="text-secondary font-semibold uppercase tracking-wider text-xs">Staff</span>' : me.isMember ? '<span class="text-on-surface-variant text-xs uppercase tracking-wider">Member</span>' : '<span class="text-error text-xs uppercase tracking-wider">Not in server</span>'}
                        ${data.guildName ? `<span class="text-outline">•</span><span class="text-outline text-xs">Active Session in ${esc(data.guildName)}</span>` : ""}
                    </div>
                    ${memberNote}
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-4 w-full xl:w-auto justify-between xl:justify-end">
                ${
                    me.isAdmin || me.isOwner
                        ? `
                <div class="flex items-center gap-3 bg-surface-container-low px-4 py-2.5 rounded-xl border border-outline-variant/20 shadow-sm">
                    <div class="flex flex-col text-left">
                        <div class="flex items-center gap-1.5">
                            ${icon("admin_panel_settings", "text-[16px] text-secondary")}
                            <span class="text-sm text-on-surface font-semibold">Admin Override Mode</span>
                        </div>
                        <span class="text-xs text-outline hidden sm:inline">Force-release any slot</span>
                    </div>
                    <button data-action="toggle-admin" aria-pressed="${state.adminMode}" class="w-11 h-6 rounded-full ${state.adminMode ? "bg-secondary-container" : "bg-surface-container-highest"} p-0.5 transition-colors focus:outline-none flex items-center ${state.adminMode ? "justify-end" : "justify-start"}">
                        <span class="w-5 h-5 rounded-full ${state.adminMode ? "bg-on-secondary" : "bg-outline"} shadow-sm transition-transform"></span>
                    </button>
                </div>`
                        : ""
                }
                <button data-action="refresh" class="flex items-center justify-center p-2.5 bg-surface-container-high hover:bg-surface-bright text-on-surface rounded-xl transition-all shadow-sm border border-outline-variant/30" title="Sync Schedule">${icon("sync", "text-[18px] text-secondary")}</button>
            </div>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-surface-container p-4 rounded-2xl shadow-sm flex items-center justify-between border border-outline-variant/20">
                <div class="flex flex-col">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-outline">Future Slots in Horizon</span>
                    <div class="flex items-baseline gap-2 mt-1">
                        <span class="text-2xl lg:text-3xl font-bold text-tertiary font-headline-xl">${futureFree}</span>
                        <span class="text-xs text-on-surface-variant font-medium">still open</span>
                    </div>
                    <span class="text-xs text-tertiary font-semibold flex items-center gap-1.5 mt-1">${icon("schedule", "text-[13px]")} ${slots.filter((s) => s.kind === "future").length} upcoming hours total</span>
                </div>
                <div class="p-3 bg-tertiary-container/20 rounded-xl text-tertiary border border-tertiary/20">${icon("hourglass_empty", "text-[24px]")}</div>
            </div>
            <div class="bg-surface-container p-4 rounded-2xl shadow-sm flex items-center justify-between border border-outline-variant/20">
                <div class="flex flex-col flex-1 max-w-sm">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-outline">Horizon Coverage</span>
                    <div class="flex items-baseline gap-2 mt-1">
                        <span class="text-2xl lg:text-3xl font-bold text-secondary font-headline-xl">${pct}%</span>
                        <span class="text-xs text-on-surface-variant font-medium">${claimed} / ${totalHours} hrs</span>
                    </div>
                    <div class="w-full max-w-[200px] h-1.5 bg-surface-container-highest rounded-full mt-2 overflow-hidden">
                        <div class="h-full bg-secondary-container ${pct === 0 ? "w-0" : `w-[${Math.min(100, pct)}%]`} rounded-full"></div>
                    </div>
                </div>
                <div class="p-3 bg-secondary-container/20 rounded-xl text-secondary border border-secondary/20 shrink-0 ml-3">${icon("verified_user", "text-[24px]")}</div>
            </div>
        </div>

        ${renderDayPicker(days, todayUTC)}

        <!-- Navigation toolbar -->
        <div class="bg-surface-container p-5 rounded-2xl shadow-sm flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 border border-outline-variant/20">
            <div class="flex items-center gap-3">
                <div class="flex items-center gap-2.5 px-4 py-2 bg-surface-container-low rounded-xl border border-outline-variant/25">
                    ${icon("event", "text-[20px] text-secondary")}
                    <span class="text-sm sm:text-base font-bold text-on-surface" id="selected-day-label">${esc(activeDay ? activeDay.longLabel : "")}</span>
                    <span class="text-[10px] px-2 py-0.5 rounded bg-surface-container-high text-secondary uppercase font-bold tracking-wide">Active View</span>
                </div>
                <span class="text-outline text-xs hidden sm:inline">Horizon: ${utcShort(startMs)} – ${utcShort(endMs)}</span>
            </div>
            <div class="flex flex-wrap items-center gap-3">
                <div class="flex items-center bg-surface-container-lowest p-1 rounded-xl border border-outline-variant/20">
                    ${filterPill("all", `All Slots (${activeDay ? activeDay.slots.length : 0})`)}
                    ${filterPill("mine", `My Slots (${activeDay ? activeDay.slots.filter((s) => s.mine).length : 0})`)}
                    ${filterPill("future", `Future Slots (${activeDay ? activeDay.slots.filter((s) => s.kind === "future").length : 0})`)}
                    ${filterPill("locked", `Locked (${activeDay ? activeDay.slots.filter((s) => s.kind === "past").length : 0})`)}
                </div>
                <button data-action="toggle-tz" class="flex items-center gap-2 bg-surface-container-low px-3.5 py-2 rounded-xl text-on-surface border border-outline-variant/20 hover:bg-surface-container-high transition-colors">
                    ${icon("schedule", "text-[16px] text-secondary")}
                    <span class="font-mono text-xs font-bold text-secondary">${state.tzLocal ? offsetLabel() : "UTC+00:00"}</span>
                    <span class="text-outline text-xs">/ ${tzName()} ${state.tzLocal ? "" : offsetLabel()}</span>
                </button>
            </div>
        </div>

        ${renderLegend()}

        <!-- Day roster -->
        <div class="flex flex-col gap-4">
            ${
                daySlots.length === 0
                    ? `
                <div class="bg-surface-container rounded-2xl border border-outline-variant/20 p-10 text-center text-on-surface-variant text-sm">No slots match this view.</div>`
                    : `
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    ${daySlots.map(slotCard).join("")}
                </div>`
            }
        </div>`;
}

function renderDayPicker(days, todayUTC) {
    return `
        <div class="w-full bg-surface-container rounded-2xl p-4 sm:p-5 shadow-md flex flex-col gap-3.5 border border-outline-variant/20">
            <div class="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-outline-variant/15">
                <div class="flex items-center gap-2 text-on-surface">
                    ${icon("date_range", "text-[20px] text-secondary")}
                    <span class="text-sm sm:text-base font-bold">Operational Horizon</span>
                    <span class="text-xs text-outline ml-1 hidden sm:inline">(Click a day to view its schedule)</span>
                </div>
                <div class="flex items-center gap-2.5 text-on-surface-variant text-xs">
                    <span class="flex items-center gap-1.5">
                        <span class="w-2 h-2 rounded-full bg-secondary animate-pulse"></span>
                        <span class="text-secondary font-semibold">${nowMs() < Date.parse(state.data.window.start) ? "Not started" : `Live Date: ${dayTitle(todayUTC, days)}`}</span>
                    </span>
                    <span class="text-outline">|</span>
                    <span class="font-mono text-primary font-semibold">${new Date(nowMs()).toISOString().slice(11, 16)} UTC</span>
                </div>
            </div>
            <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5 pt-0.5">
                ${days.map((d, i) => dayPill(d, i, days.length, todayUTC)).join("")}
            </div>
        </div>`;
}

function dayTitle(key, days) {
    const d = days.find((x) => x.key === key);
    return d ? d.shortLabel : key;
}

function buildDays(slots) {
    const byKey = new Map();
    for (const s of slots) {
        const key = utcDayKey(s.start);
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push(s);
    }
    const keys = [...byKey.keys()].sort();
    return keys.map((key, i) => {
        const daySlots = byKey.get(key).sort((a, b) => a.start - b.start);
        const first = daySlots[0].start;
        const last = daySlots[daySlots.length - 1].end;
        const d = new Date(`${key}T00:00:00Z`);
        const isFirst = i === 0;
        const isLast = i === keys.length - 1;
        const count = daySlots.length;
        const sub =
            isFirst && count < 24
                ? `from ${formatHour(first, false)}`
                : isLast && count < 24
                  ? `until ${formatHour(last - HOUR, false)}`
                  : `${count} Hours`;
        return {
            key,
            slots: daySlots,
            shortLabel: `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
            longLabel: `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
            dayNum: i + 1,
            sub,
            firstMs: first,
            lastMs: last,
        };
    });
}

function dayPill(d, i, total, todayUTC) {
    const now = nowMs();
    const past = d.lastMs <= now;
    const today = d.key === todayUTC;
    const live = d.slots.some((s) => s.kind === "live");
    const selected = d.key === state.dayKey;
    const isFirstPartial = i === 0 && d.slots.length < 24;
    const isLastPartial = i === total - 1 && d.slots.length < 24;

    let status = "";
    let cls =
        "bg-surface-container-low border border-outline-variant/30 text-on-surface hover:bg-surface-container-high transition-all";
    if (selected)
        cls =
            "bg-primary-container text-on-primary-container border-2 border-secondary shadow-md transition-all relative overflow-hidden ring-2 ring-secondary/20";
    else if (past)
        cls =
            "bg-surface-container-lowest/80 border border-outline-variant/20 text-outline hover:border-outline/50 transition-all opacity-75 hover:opacity-100";

    if (today && !past) status = `<span class="text-[9px] text-white/80 mt-0.5">Today</span>`;
    else if (past) status = `<span class="text-[9px] text-outline mt-0.5">Past (Locked)</span>`;
    else if (live) status = "";

    return `
        <button data-action="select-day" data-day="${d.key}" class="flex flex-col items-center justify-center py-1.5 px-1 rounded-xl ${cls}">
            ${today && !past ? `<span class="absolute top-1 right-1 w-1.5 h-1.5 bg-secondary rounded-full"></span>` : ""}
            <span class="text-[9px] uppercase tracking-wider ${selected ? "text-secondary-fixed" : "text-outline"} font-semibold">Day ${d.dayNum}</span>
            <span class="text-xs ${selected ? "font-bold text-white" : "text-on-surface-variant font-semibold"} mt-0.5">${d.shortLabel}</span>
            <span class="text-[9px] px-1 py-0.2 rounded ${selected ? "bg-surface-container-highest text-secondary" : isFirstPartial ? "bg-surface-container mt-1 text-outline" : isLastPartial ? "bg-tertiary-container/30 text-tertiary font-bold" : "bg-surface-container mt-1 text-outline"} mt-1">${esc(d.sub)}</span>
            ${status || (isFirstPartial ? `<span class="text-[9px] text-outline mt-0.5">Opens</span>` : isLastPartial ? `<span class="text-[9px] text-secondary mt-0.5">Closes</span>` : `<span class="text-[9px] text-outline mt-0.5">&nbsp;</span>`)}
        </button>`;
}

function filterPill(key, label) {
    const active = state.filter === key;
    return `
        <button data-action="filter" data-filter="${key}" class="px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${active ? "bg-surface-container-high text-on-surface shadow-sm" : "text-on-surface-variant hover:text-on-surface"}">${esc(label)}</button>`;
}

function filterSlot(s) {
    if (state.filter === "mine") return s.mine;
    if (state.filter === "future") return s.kind === "future";
    if (state.filter === "locked") return s.kind === "past";
    return true;
}

function renderLegend() {
    return `
        <div class="w-full bg-surface-container-low px-5 py-3 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-on-surface-variant border border-outline-variant/20 text-xs">
            <div class="flex items-center gap-2">
                <span class="font-bold uppercase tracking-wider text-outline text-[11px]">Legend:</span>
            </div>
            <div class="flex flex-wrap items-center gap-5 sm:gap-6">
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-outline-variant"></span><span>Past Window (Locked)</span></div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></span><span class="text-on-surface font-semibold">Active Window (Live Now)</span></div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-secondary"></span><span class="text-on-surface">Claimed by You</span></div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-tertiary"></span><span>Future Slot</span></div>
                <div class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-full bg-primary-container"></span><span>Claimed by Staff</span></div>
                <div class="flex items-center gap-2"><span class="material-symbols-outlined text-[14px] text-error">shield</span><span class="text-error">Admin Force Unassign</span></div>
            </div>
        </div>`;
}

function slotCard(slot) {
    const me = state.data.me;
    const tz = state.tzLocal;
    const range = formatRangeLabel(slot.start, slot.end, tz);
    const tzSuffix = tz ? "local" : "UTC";
    const who = slot.name ? slot.name : esc(slot.userId);

    if (slot.kind === "past") {
        return `
            <div class="bg-surface-container-low/70 p-4 rounded-xl flex flex-col justify-between border border-outline-variant/20 shadow-sm opacity-75 hover:opacity-90 transition-opacity">
                <div>
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="text-sm font-bold text-outline tracking-tight">${range} ${tzSuffix}</div>
                        </div>
                        <span class="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-surface-container text-outline border border-outline-variant/20 uppercase tracking-wider">${icon("lock", "text-[12px]")} Locked</span>
                    </div>
                    ${
                        slot.claimed
                            ? `
                    <div class="my-2.5 flex items-center justify-between bg-surface-container-lowest/80 px-3 py-2 rounded-lg border ${slot.mine ? "border-secondary/20" : "border-outline-variant/10"}">
                        <span class="font-mono text-xs font-semibold ${slot.mine ? "text-secondary" : "text-on-surface-variant"}">${slot.mine ? `@${esc(me.username)} (You)` : esc(who)}</span>
                        <span class="text-[10px] ${slot.mine ? "text-secondary/80" : "text-outline"} font-medium">${slot.mine ? "Finished" : "Completed"}</span>
                    </div>`
                            : ""
                    }
                </div>
                <div class="w-full text-center py-1.5 text-[11px] font-semibold text-outline bg-surface-container/60 rounded-lg border border-outline-variant/15">Past Window Locked</div>
            </div>`;
    }

    if (slot.kind === "live") {
        return `
            <div class="bg-surface-container p-4 rounded-xl shadow-lg relative flex flex-col justify-between border-2 border-secondary/50 overflow-hidden ring-2 ring-secondary/20">
                <div class="absolute -top-10 -right-10 w-28 h-28 bg-secondary/10 rounded-full blur-xl pointer-events-none"></div>
                <div class="relative">
                    <div class="flex items-start justify-between gap-2">
                        <div>
                            <div class="text-sm font-bold text-secondary tracking-tight flex items-center gap-1.5">
                                ${range} ${tzSuffix}
                                <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-ping"></span>
                            </div>
                            <div class="text-[11px] text-primary font-medium mt-0.5">Active Window</div>
                        </div>
                        <span class="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-secondary-container text-on-secondary shadow uppercase tracking-wider">
                            <span class="w-1.5 h-1.5 rounded-full bg-on-secondary animate-pulse"></span> LIVE NOW
                        </span>
                    </div>
                    ${
                        slot.claimed
                            ? `
                    <div class="my-2.5 flex items-center justify-between bg-surface-container-high/90 px-3 py-2 rounded-lg border ${slot.mine ? "border-secondary/30" : "border-outline-variant/20"} shadow-inner">
                        <span class="font-mono text-xs font-bold ${slot.mine ? "text-secondary" : "text-on-surface"}">${slot.mine ? `@${esc(me.username)} (You)` : esc(who)}</span>
                        <span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-secondary/20 text-secondary border border-secondary/30">Claimed</span>
                    </div>`
                            : `
                    <div class="my-2.5 flex items-center justify-between bg-surface-container-lowest px-3 py-2 rounded-lg border border-outline-variant/20">
                        <span class="font-mono text-xs text-outline">Nobody claimed this window</span>
                    </div>`
                    }
                </div>
                <div class="flex items-center justify-between bg-surface-container-lowest px-3 py-1.5 rounded-lg border border-outline-variant/20 text-[11px]">
                    <span class="flex items-center gap-1 text-outline font-medium">${icon("lock_clock", "text-[13px] text-primary")} In Progress</span>
                    <span class="font-mono text-on-surface font-bold text-[11px]" data-live-end="${slot.end}"></span>
                </div>
            </div>`;
    }

    // future
    const free = !slot.claimed;
    const canForce = (me.isAdmin || me.isOwner) && state.adminMode;
    let button = "";
    if (free) {
        button = me.isMember
            ? `<button data-action="claim" data-start="${slot.start}" class="w-full py-2 px-3 rounded-lg bg-primary-container hover:bg-inverse-primary text-on-primary-container text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-sm active:scale-[0.98]">${icon("bookmark_add", "text-[15px]")} Claim Slot (1h)</button>`
            : `<button disabled class="w-full py-2 px-3 rounded-lg bg-surface-container-high text-outline text-xs font-bold flex items-center justify-center gap-1.5 cursor-not-allowed" title="Join the Discord server to claim">${icon("bookmark_add", "text-[15px]")} Join server to claim</button>`;
    } else if (slot.mine) {
        button = `<button data-action="release" data-start="${slot.start}" class="w-full py-2 px-3 rounded-lg bg-surface-container-high hover:bg-error/20 text-error hover:border-error/40 border border-outline-variant/30 text-xs font-bold flex items-center justify-center gap-1.5 transition-all">${icon("event_busy", "text-[15px]")} Unassign Self</button>`;
    } else if (canForce) {
        button = `<button data-action="force-release" data-start="${slot.start}" class="w-full py-2 px-3 rounded-lg bg-error/15 hover:bg-error text-error hover:text-on-error text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-error/25 hover:border-transparent">${icon("person_remove", "text-[15px]")} Admin Force Unassign</button>`;
    }

    const cardCls = free
        ? "bg-surface-container-low p-4 rounded-xl shadow-sm flex flex-col justify-between group hover:bg-surface-container transition-all border border-tertiary/30 hover:border-tertiary/60"
        : slot.mine
          ? "bg-surface-container p-4 rounded-xl shadow-md flex flex-col justify-between relative overflow-hidden border-2 border-secondary-container/50"
          : "bg-surface-container p-4 rounded-xl shadow-sm flex flex-col justify-between border border-outline-variant/25 hover:border-outline-variant/50 transition-all";

    const badge = free
        ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-tertiary-container/30 text-tertiary border border-tertiary/30 uppercase tracking-wider">Future Slot</span>`
        : `<span class="text-[10px] font-bold px-2 py-0.5 rounded ${slot.mine ? "bg-secondary-container/20 text-secondary border border-secondary/30" : "bg-surface-container-high text-on-surface-variant border border-outline-variant/30"} uppercase tracking-wider">Claimed</span>`;

    const leftAccent = slot.mine
        ? `<div class="absolute top-0 left-0 bottom-0 w-1.5 bg-secondary-container"></div>`
        : "";
    const contentPad = slot.mine ? "pl-1.5" : "";

    return `
        <div class="${cardCls}">
            ${leftAccent}
            <div class="${contentPad}">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="text-sm font-bold ${free ? "text-on-surface" : slot.mine ? "text-secondary" : "text-on-surface"} tracking-tight">${range} ${tzSuffix}</div>
                    </div>
                    ${badge}
                </div>
                <div class="my-2.5 flex items-center justify-between bg-surface-container-lowest px-3 py-2 rounded-lg border ${slot.claimed ? (slot.mine ? "border-secondary/30 pl-2.5" : "border-outline-variant/20") : "border-outline-variant/20"}">
                    <span class="font-mono text-xs ${slot.claimed ? (slot.mine ? "font-bold text-secondary" : "font-semibold text-on-surface") : "text-outline"}">${slot.claimed ? (slot.mine ? `@${esc(me.username)} (You)` : esc(who)) : "Future Slot"}</span>
                    <span class="text-[10px] ${slot.claimed ? (slot.mine ? "text-secondary font-semibold bg-secondary/15 px-1.5 py-0.2 rounded" : "text-secondary font-medium flex items-center gap-0.5") : "font-bold text-tertiary bg-tertiary/10 px-1.5 py-0.2 rounded"}">${slot.claimed ? (slot.mine ? "Assigned" : `${icon("check", "text-[12px]")} Confirmed`) : "0 / 1 Staff"}</span>
                </div>
            </div>
            ${button}
        </div>`;
}

function attachCountdowns() {
    const update = () => {
        const now = nowMs();
        for (const el of document.querySelectorAll("[data-live-end]")) {
            const remain = Number(el.getAttribute("data-live-end")) - now;
            el.textContent =
                remain <= 0
                    ? "ending now"
                    : `${Math.floor(remain / 60000)}m ${Math.floor((remain % 60000) / 1000)}s left`;
        }
    };
    update();
    clearInterval(state.countdownTimer);
    state.countdownTimer = setInterval(update, 1000);
}

function utcShort(ms) {
    const d = new Date(ms);
    return `${DAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${formatHour(ms, false)} UTC`;
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------

async function mutate(action, startMs) {
    try {
        await api("/api/slot", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action, start: new Date(Number(startMs)).toISOString() }),
        });
        const key = state.dayKey;
        await refresh();
        state.dayKey = key;
        showToast(action === "claim" ? "Slot claimed!" : "Slot released.");
    } catch (error) {
        toastError(error);
    }
}

async function refresh() {
    try {
        const body = await api("/api/state");
        if (!body) return;
        state.data = body;
        state.fetchedAt = Date.now();
        render();
    } catch (error) {
        toastError(error);
    }
}

function load() {
    api("/api/me")
        .then((body) => {
            if (!body) return;
            if (!body.me.access) {
                renderNoAccess(body.me);
                return;
            }
            return refresh();
        })
        .catch(() => renderLoggedOut());
}

function renderNoAccess(me) {
    document.title = "Grassmower — Push Calendar";
    state.data = { me, guildName: null };
    app.innerHTML = `
        ${renderHeader(me)}
        <main class="min-h-screen flex items-center justify-center pt-16 px-4">
            <div class="bg-surface-container rounded-2xl shadow-lg border border-outline-variant/20 p-8 max-w-md text-center flex flex-col items-center gap-4">
                <div class="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-container to-secondary/40 flex items-center justify-center">${icon("lock", "text-[26px] text-secondary")}</div>
                <div>
                    <h1 class="font-headline-lg text-headline-lg font-bold">Restricted calendar</h1>
                    <p class="text-on-surface-variant text-sm mt-1">This push calendar is only visible to members holding the configured role. Ask a staff member if you should have access.</p>
                </div>
                <button data-action="logout" class="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-high hover:bg-surface-bright text-on-surface text-sm font-bold transition-colors border border-outline-variant/30">
                    ${icon("logout", "text-[16px]")} Log out
                </button>
            </div>
        </main>`;
}

document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-action]");
    if (!el) return;
    const action = el.getAttribute("data-action");
    if (action === "login") {
        window.location.href = "/api/auth/login";
    } else if (action === "logout") {
        window.location.href = "/api/auth/logout";
    } else if (action === "dismiss-toast") {
        toastEl.classList.add("hidden");
    } else if (action === "refresh") {
        refresh();
    } else if (action === "select-day") {
        state.dayKey = el.getAttribute("data-day");
        render();
    } else if (action === "filter") {
        state.filter = el.getAttribute("data-filter");
        render();
    } else if (action === "toggle-tz") {
        state.tzLocal = !state.tzLocal;
        render();
    } else if (action === "toggle-admin") {
        state.adminMode = !state.adminMode;
        render();
    } else if (action === "claim") {
        mutate("claim", el.getAttribute("data-start"));
    } else if (action === "release" || action === "force-release") {
        mutate("release", el.getAttribute("data-start"));
    }
});

setInterval(() => {
    if (state.data) refresh();
}, 60000);

load();
