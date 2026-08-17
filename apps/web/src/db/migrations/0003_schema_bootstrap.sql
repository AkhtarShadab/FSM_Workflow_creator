CREATE TABLE `checkpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`state_id` text,
	`key` text,
	`summary` text,
	`history_json` text,
	`tokens_saved` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `code_symbols` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`kind` text NOT NULL,
	`intent` text NOT NULL,
	`identity` text NOT NULL,
	`file_path` text NOT NULL,
	`start_line` integer,
	`end_line` integer,
	`language` text,
	`hash` text NOT NULL,
	`embedding_ref` text,
	`chunk_ref` text,
	`indexed_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `code_symbols_project_path` ON `code_symbols` (`project_id`,`file_path`);--> statement-breakpoint
CREATE INDEX `code_symbols_project_identity` ON `code_symbols` (`project_id`,`identity`);--> statement-breakpoint
CREATE TABLE `fsm_drafts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`canvas_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fsm_drafts_project_id_unique` ON `fsm_drafts` (`project_id`);--> statement-breakpoint
CREATE TABLE `human_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`state_id` text,
	`prompt` text,
	`assignee` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`response_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`resolved_at` integer,
	`expires_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer,
	`run_id` integer,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link_path` text,
	`dedupe_key` text,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_read_at_created_at` ON `notifications` (`read_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`fsm_id` integer,
	`name` text,
	`kind` text,
	`cron_expr` text,
	`run_at` integer,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`payload_json` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` integer,
	`last_run_id` integer,
	`next_run_at` integer NOT NULL,
	`claimed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fsm_id`) REFERENCES `fsm_definitions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `schedules_enabled_next_run_at` ON `schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
ALTER TABLE `credentials` ADD `last4` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `credentials` ADD `active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `credentials` ADD `models_json` text;--> statement-breakpoint
ALTER TABLE `credentials` ADD `discovery_status` text;--> statement-breakpoint
ALTER TABLE `credentials` ADD `discovery_error` text;--> statement-breakpoint
ALTER TABLE `credentials` ADD `discovered_at` integer;--> statement-breakpoint
ALTER TABLE `credentials` ADD `revoked_at` integer;--> statement-breakpoint
ALTER TABLE `export_jobs` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `export_jobs` ADD `size_bytes` integer;--> statement-breakpoint
ALTER TABLE `export_jobs` ADD `error` text;--> statement-breakpoint
ALTER TABLE `fsm_definitions` ADD `content_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `fsm_definitions` ADD `label` text;--> statement-breakpoint
CREATE UNIQUE INDEX `fsm_definitions_project_id_version_unique` ON `fsm_definitions` (`project_id`,`version`);--> statement-breakpoint
ALTER TABLE `runs` ADD `triggered_by` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `schedule_id` integer REFERENCES schedules(id);