CREATE TABLE `target_farms` (
	`guild_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	CONSTRAINT `target_farms_guild_id_name_pk` PRIMARY KEY(`guild_id`,`name`)
);
--> statement-breakpoint
ALTER TABLE `guild_settings` ADD `targets_channel_id` varchar(64);--> statement-breakpoint
ALTER TABLE `guild_settings` ADD `targets_message_id` varchar(64);--> statement-breakpoint
ALTER TABLE `guild_settings` ADD `targets_primary` varchar(255);--> statement-breakpoint
ALTER TABLE `guild_settings` ADD `targets_secondary` varchar(255);