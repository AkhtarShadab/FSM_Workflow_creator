CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`provider` text NOT NULL,
	`base_url` text,
	`encrypted_key` text NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fsm_id` integer NOT NULL,
	`target` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`artifact_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`fsm_id`) REFERENCES `fsm_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `fsm_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`json` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`state_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text,
	`tokens_in` integer,
	`tokens_out` integer,
	`latency_ms` real,
	`ts` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fsm_id` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ended_at` integer,
	`token_usage_json` text,
	FOREIGN KEY (`fsm_id`) REFERENCES `fsm_definitions`(`id`) ON UPDATE no action ON DELETE cascade
);
