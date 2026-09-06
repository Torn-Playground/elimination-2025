import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const guildSettings = sqliteTable("guild_settings", {
    guildId: text("guild_id").primaryKey(),
    verifiedRoleId: text("verified_role_id"),
    notVerifiedChannelId: text("not_verified_channel_id"),
    managementChannelId: text("management_channel_id"),
});

export const teamRoles = sqliteTable(
    "team_roles",
    {
        guildId: text("guild_id").notNull(),
        name: text("name").notNull(),
        roleId: text("role_id").notNull(),
    },
    (table) => [primaryKey({ columns: [table.guildId, table.name] })],
);

export const apiKeys = sqliteTable("api_keys", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    playerId: integer("player_id").notNull(),
    playerName: text("player_name").notNull(),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .notNull()
        .$defaultFn(() => new Date()),
});
