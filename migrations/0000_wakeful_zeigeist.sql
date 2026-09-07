CREATE TABLE `activity_chart_cache` (
	`team_id` int NOT NULL,
	`stat` varchar(32) NOT NULL,
	`last_observed_at` datetime(3) NOT NULL,
	`png` longblob NOT NULL,
	`generated_at` datetime(3) NOT NULL,
	CONSTRAINT `activity_chart_cache_team_id_stat_pk` PRIMARY KEY(`team_id`,`stat`)
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(255) NOT NULL,
	`player_id` int NOT NULL,
	`player_name` varchar(255) NOT NULL,
	`last_used_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `elimination_team_snapshots` (
	`team_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`participants` int NOT NULL,
	`position` int NOT NULL,
	`score` int NOT NULL,
	`lives` int NOT NULL,
	`wins` int NOT NULL,
	`losses` int NOT NULL,
	`eliminated` boolean NOT NULL,
	`eliminated_timestamp` bigint,
	`observed_at` datetime(3) NOT NULL,
	CONSTRAINT `elimination_team_snapshots_team_id_observed_at_pk` PRIMARY KEY(`team_id`,`observed_at`)
);
--> statement-breakpoint
CREATE TABLE `guild_settings` (
	`guild_id` varchar(64) NOT NULL,
	`verified_role_id` varchar(64),
	`not_verified_channel_id` varchar(64),
	`management_channel_id` varchar(64),
	CONSTRAINT `guild_settings_guild_id` PRIMARY KEY(`guild_id`)
);
--> statement-breakpoint
CREATE TABLE `team_roles` (
	`guild_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`role_id` varchar(64) NOT NULL,
	CONSTRAINT `team_roles_guild_id_name_pk` PRIMARY KEY(`guild_id`,`name`)
);
