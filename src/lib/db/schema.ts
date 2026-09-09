import {
    bigint,
    boolean,
    customType,
    datetime,
    int,
    mysqlTable,
    primaryKey,
    varchar,
} from "drizzle-orm/mysql-core";

const longblob = customType<{ data: Buffer; driverData: Buffer }>({
    dataType() {
        return "longblob";
    },
});

const DISCORD_ID_LEN = 64;
const NAME_LEN = 255;

export const guildSettings = mysqlTable("guild_settings", {
    guildId: varchar("guild_id", { length: DISCORD_ID_LEN }).primaryKey(),
    verifiedRoleId: varchar("verified_role_id", { length: DISCORD_ID_LEN }),
    notVerifiedChannelId: varchar("not_verified_channel_id", { length: DISCORD_ID_LEN }),
    managementChannelId: varchar("management_channel_id", { length: DISCORD_ID_LEN }),
    targetsChannelId: varchar("targets_channel_id", { length: DISCORD_ID_LEN }),
    targetsMessageId: varchar("targets_message_id", { length: DISCORD_ID_LEN }),
    targetsPrimary: varchar("targets_primary", { length: NAME_LEN }),
    targetsSecondary: varchar("targets_secondary", { length: NAME_LEN }),
});

export const teamRoles = mysqlTable(
    "team_roles",
    {
        guildId: varchar("guild_id", { length: DISCORD_ID_LEN }).notNull(),
        name: varchar("name", { length: NAME_LEN }).notNull(),
        roleId: varchar("role_id", { length: DISCORD_ID_LEN }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.guildId, table.name] })],
);

export const targetFarms = mysqlTable(
    "target_farms",
    {
        guildId: varchar("guild_id", { length: DISCORD_ID_LEN }).notNull(),
        name: varchar("name", { length: NAME_LEN }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.guildId, table.name] })],
);

export const eliminationTeamSnapshots = mysqlTable(
    "elimination_team_snapshots",
    {
        teamId: int("team_id").notNull(),
        name: varchar("name", { length: NAME_LEN }).notNull(),
        participants: int("participants").notNull(),
        position: int("position").notNull(),
        score: int("score").notNull(),
        lives: int("lives").notNull(),
        wins: int("wins").notNull(),
        losses: int("losses").notNull(),
        eliminated: boolean("eliminated").notNull(),
        eliminatedTimestamp: bigint("eliminated_timestamp", { mode: "number" }),
        observedAt: datetime("observed_at", { mode: "date", fsp: 3 }).notNull(),
    },
    (table) => [primaryKey({ columns: [table.teamId, table.observedAt] })],
);

export const activityChartCache = mysqlTable(
    "activity_chart_cache",
    {
        teamId: int("team_id").notNull(),
        stat: varchar("stat", { length: 32 }).notNull(),
        lastObservedAt: datetime("last_observed_at", { mode: "date", fsp: 3 }).notNull(),
        png: longblob("png").notNull(),
        generatedAt: datetime("generated_at", { mode: "date", fsp: 3 })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (table) => [primaryKey({ columns: [table.teamId, table.stat] })],
);

export const apiKeys = mysqlTable("api_keys", {
    id: int("id").autoincrement().primaryKey(),
    key: varchar("key", { length: NAME_LEN }).notNull().unique(),
    playerId: int("player_id").notNull(),
    playerName: varchar("player_name", { length: NAME_LEN }).notNull(),
    lastUsedAt: datetime("last_used_at", { mode: "date", fsp: 3 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 3 })
        .notNull()
        .$defaultFn(() => new Date()),
});

const ROLE_IDS_LEN = 2048;

export const pushSettings = mysqlTable("push_settings", {
    id: int("id").autoincrement().primaryKey(),
    guildId: varchar("guild_id", { length: DISCORD_ID_LEN }),
    channelId: varchar("channel_id", { length: DISCORD_ID_LEN }),
    roleId: varchar("role_id", { length: DISCORD_ID_LEN }),
    adminRoleIds: varchar("admin_role_ids", { length: ROLE_IDS_LEN }),
    leadMinutes: int("lead_minutes").notNull().default(60),
    start: datetime("start", { mode: "date" }),
    end: datetime("end", { mode: "date" }),
});

export const pushSlots = mysqlTable("push_slots", {
    start: datetime("start", { mode: "date" }).primaryKey(),
    userId: varchar("user_id", { length: DISCORD_ID_LEN }),
    claimedAt: datetime("claimed_at", { mode: "date" }),
});

export const pushReminders = mysqlTable(
    "push_reminders",
    {
        start: datetime("start", { mode: "date" }).notNull(),
        kind: varchar("kind", { length: 16 }).notNull(),
        sentAt: datetime("sent_at", { mode: "date" })
            .notNull()
            .$defaultFn(() => new Date()),
    },
    (table) => [primaryKey({ columns: [table.start, table.kind] })],
);

export const webSessions = mysqlTable("web_sessions", {
    token: varchar("token", { length: 64 }).primaryKey(),
    userId: varchar("user_id", { length: DISCORD_ID_LEN }).notNull(),
    username: varchar("username", { length: NAME_LEN }).notNull(),
    avatar: varchar("avatar", { length: NAME_LEN }).notNull(),
    createdAt: datetime("created_at", { mode: "date" })
        .notNull()
        .$defaultFn(() => new Date()),
    expiresAt: datetime("expires_at", { mode: "date" }).notNull(),
});
