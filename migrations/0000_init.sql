CREATE TABLE `api_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`player_id` integer NOT NULL,
	`player_name` text NOT NULL,
	`last_used_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_unique` ON `api_keys` (`key`);--> statement-breakpoint
CREATE TABLE `guild_settings` (
	`guild_id` text PRIMARY KEY NOT NULL,
	`verified_role_id` text,
	`not_verified_channel_id` text,
	`management_channel_id` text
);
--> statement-breakpoint
CREATE TABLE `team_roles` (
	`guild_id` text NOT NULL,
	`name` text NOT NULL,
	`role_id` text NOT NULL,
	PRIMARY KEY(`guild_id`, `name`)
);
