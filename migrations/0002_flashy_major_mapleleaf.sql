CREATE TABLE `activity_chart_cache` (
	`team_id` integer NOT NULL,
	`stat` text NOT NULL,
	`last_observed_at` integer NOT NULL,
	`png` blob NOT NULL,
	`generated_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `stat`)
);
