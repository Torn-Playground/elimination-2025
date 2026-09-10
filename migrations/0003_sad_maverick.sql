CREATE TABLE `elimination_team_member_sync` (
	`team_id` int NOT NULL,
	`next_offset` int NOT NULL DEFAULT 0,
	`refresh_started_at` datetime(3),
	`refreshed_at` datetime(3),
	CONSTRAINT `elimination_team_member_sync_team_id` PRIMARY KEY(`team_id`)
);
--> statement-breakpoint
CREATE TABLE `elimination_team_members` (
	`team_id` int NOT NULL,
	`user_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`level` int NOT NULL,
	`last_action` varchar(16) NOT NULL,
	`last_action_timestamp` bigint,
	`status` varchar(255) NOT NULL,
	`attacks` int NOT NULL,
	`score` int NOT NULL,
	`refreshed_at` datetime(3) NOT NULL,
	CONSTRAINT `elimination_team_members_team_id_user_id_pk` PRIMARY KEY(`team_id`,`user_id`)
);
