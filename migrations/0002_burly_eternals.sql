CREATE TABLE `push_reminders` (
	`start` datetime NOT NULL,
	`kind` varchar(16) NOT NULL,
	`sent_at` datetime NOT NULL,
	CONSTRAINT `push_reminders_start_kind_pk` PRIMARY KEY(`start`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `push_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`guild_id` varchar(64),
	`channel_id` varchar(64),
	`role_id` varchar(64),
	`admin_role_ids` varchar(2048),
	`lead_minutes` int NOT NULL DEFAULT 60,
	`start` datetime,
	`end` datetime,
	CONSTRAINT `push_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_slots` (
	`start` datetime NOT NULL,
	`user_id` varchar(64),
	`claimed_at` datetime,
	CONSTRAINT `push_slots_start` PRIMARY KEY(`start`)
);
--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`token` varchar(64) NOT NULL,
	`user_id` varchar(64) NOT NULL,
	`username` varchar(255) NOT NULL,
	`avatar` varchar(255) NOT NULL,
	`created_at` datetime NOT NULL,
	`expires_at` datetime NOT NULL,
	CONSTRAINT `web_sessions_token` PRIMARY KEY(`token`)
);
