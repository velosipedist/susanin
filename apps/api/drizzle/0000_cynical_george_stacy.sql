CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer NOT NULL,
	`display_name` text NOT NULL,
	`group_name` text,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`group_name`) REFERENCES `groups`(`name`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_telegram_id_unique` ON `accounts` (`telegram_id`);--> statement-breakpoint
CREATE TABLE `field_states` (
	`account_id` integer NOT NULL,
	`topic_id` integer NOT NULL,
	`field_key` text NOT NULL,
	`value` text NOT NULL,
	`graded_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `topic_id`, `field_key`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`topic_id`,`field_key`) REFERENCES `topic_fields`(`topic_id`,`key`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "field_states_value_check" CHECK("field_states"."value" IN ('learned', 'unlearned'))
);
--> statement-breakpoint
CREATE TABLE `group_sections` (
	`group_name` text NOT NULL,
	`section_number` integer NOT NULL,
	PRIMARY KEY(`group_name`, `section_number`),
	FOREIGN KEY (`group_name`) REFERENCES `groups`(`name`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`section_number`) REFERENCES `sections`(`number`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `group_sections_section_unique` ON `group_sections` (`section_number`);--> statement-breakpoint
CREATE TABLE `groups` (
	`name` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `invite_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`telegram_id` integer NOT NULL,
	`attempted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invite_attempts_lookup` ON `invite_attempts` (`telegram_id`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `sections` (
	`number` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `topic_fields` (
	`topic_id` integer NOT NULL,
	`key` text NOT NULL,
	`text` text DEFAULT '' NOT NULL,
	`not_applicable` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`topic_id`, `key`),
	FOREIGN KEY (`topic_id`) REFERENCES `topics`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "topic_fields_key_check" CHECK("topic_fields"."key" IN ('what', 'when', 'where', 'why', 'who', 'how'))
);
--> statement-breakpoint
CREATE TABLE `topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`section_number` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`side` text,
	FOREIGN KEY (`section_number`) REFERENCES `sections`(`number`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "topics_side_check" CHECK("topics"."side" IS NULL OR "topics"."side" IN ('left', 'supplementary', 'right'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `topics_section_position_unique` ON `topics` (`section_number`,`position`);--> statement-breakpoint
CREATE TRIGGER `topics_always_six_fields` AFTER INSERT ON `topics`
BEGIN
	INSERT INTO `topic_fields` (`topic_id`, `key`) VALUES
		(NEW.`id`, 'what'),
		(NEW.`id`, 'when'),
		(NEW.`id`, 'where'),
		(NEW.`id`, 'why'),
		(NEW.`id`, 'who'),
		(NEW.`id`, 'how');
END;--> statement-breakpoint
CREATE TRIGGER `topic_fields_never_more_than_six` BEFORE INSERT ON `topic_fields`
WHEN (SELECT count(*) FROM `topic_fields` WHERE `topic_id` = NEW.`topic_id`) >= 6
BEGIN
	SELECT RAISE(ABORT, 'a topic always has exactly six fields');
END;--> statement-breakpoint
CREATE TRIGGER `topic_fields_never_deleted` BEFORE DELETE ON `topic_fields`
WHEN EXISTS (SELECT 1 FROM `topics` WHERE `id` = OLD.`topic_id`)
BEGIN
	SELECT RAISE(ABORT, 'a topic always has exactly six fields');
END;