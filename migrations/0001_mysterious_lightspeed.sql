CREATE TABLE `elimination_team_snapshots` (
	`team_id` integer NOT NULL,
	`name` text NOT NULL,
	`participants` integer NOT NULL,
	`position` integer NOT NULL,
	`score` integer NOT NULL,
	`lives` integer NOT NULL,
	`wins` integer NOT NULL,
	`losses` integer NOT NULL,
	`eliminated` integer NOT NULL,
	`eliminated_timestamp` integer,
	`observed_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `observed_at`)
);
