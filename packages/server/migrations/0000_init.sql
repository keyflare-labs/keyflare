CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`type` text NOT NULL,
	`label` text,
	`scopes` text,
	`permissions` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_key_hash_unique` ON `api_keys` (`key_hash`);--> statement-breakpoint
CREATE TABLE `environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name_encrypted` text NOT NULL,
	`name_hash` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environments_project_id_name_hash_unique` ON `environments` (`project_id`,`name_hash`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name_encrypted` text NOT NULL,
	`name_hash` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_hash_unique` ON `projects` (`name_hash`);--> statement-breakpoint
CREATE TABLE `secrets` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`key_encrypted` text NOT NULL,
	`key_hash` text NOT NULL,
	`value_encrypted` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `secrets_environment_id_key_hash_unique` ON `secrets` (`environment_id`,`key_hash`);