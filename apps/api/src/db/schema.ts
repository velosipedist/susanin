import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';
import { FIELD_KEYS, SIDES } from '@susanin/shared';

const list = (values: readonly string[]) => sql.raw(values.map((value) => `'${value}'`).join(', '));

/** The five cohorts. Every account belongs to exactly one, once onboarding is complete. */
export const groups = sqliteTable('groups', {
	name: text('name').primaryKey()
});

/** A numbered block of the tour. The number is the route order. */
export const sections = sqliteTable('sections', {
	number: integer('number').primaryKey(),
	name: text('name').notNull()
});

/**
 * A section belongs to at most one group. The unique index on `section_number`
 * is the whole rule; a group simply holds many sections.
 */
export const groupSections = sqliteTable(
	'group_sections',
	{
		groupName: text('group_name')
			.notNull()
			.references(() => groups.name, { onDelete: 'cascade' }),
		sectionNumber: integer('section_number')
			.notNull()
			.references(() => sections.number, { onDelete: 'cascade' })
	},
	(table) => [
		primaryKey({ columns: [table.groupName, table.sectionNumber] }),
		uniqueIndex('group_sections_section_unique').on(table.sectionNumber)
	]
);

export const accounts = sqliteTable('accounts', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	telegramId: integer('telegram_id').notNull().unique(),
	displayName: text('display_name').notNull(),
	groupName: text('group_name').references(() => groups.name),
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: integer('created_at').notNull()
});

/** One item of a section's commentary at a fixed position in the route. */
export const topics = sqliteTable(
	'topics',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sectionNumber: integer('section_number')
			.notNull()
			.references(() => sections.number, { onDelete: 'cascade' }),
		position: integer('position').notNull(),
		name: text('name').notNull(),
		side: text('side')
	},
	(table) => [
		uniqueIndex('topics_section_position_unique').on(table.sectionNumber, table.position),
		check('topics_side_check', sql`${table.side} IS NULL OR ${table.side} IN (${list(SIDES)})`)
	]
);

/**
 * Exactly six rows per topic, one per field key. `topics_always_six_fields` and
 * `topic_fields_never_more_than_six` keep the invariant in the database rather
 * than trusting every caller.
 */
export const topicFields = sqliteTable(
	'topic_fields',
	{
		topicId: integer('topic_id')
			.notNull()
			.references(() => topics.id, { onDelete: 'cascade' }),
		key: text('key').notNull(),
		text: text('text').notNull().default(''),
		notApplicable: integer('not_applicable', { mode: 'boolean' }).notNull().default(false)
	},
	(table) => [
		primaryKey({ columns: [table.topicId, table.key] }),
		check('topic_fields_key_check', sql`${table.key} IN (${list(FIELD_KEYS)})`)
	]
);

/** A learner's graded verdict per field. Absence of a row means Untouched. */
export const fieldStates = sqliteTable(
	'field_states',
	{
		accountId: integer('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		topicId: integer('topic_id').notNull(),
		fieldKey: text('field_key').notNull(),
		value: text('value').notNull(),
		gradedAt: integer('graded_at').notNull()
	},
	(table) => [
		primaryKey({ columns: [table.accountId, table.topicId, table.fieldKey] }),
		foreignKey({
			columns: [table.topicId, table.fieldKey],
			foreignColumns: [topicFields.topicId, topicFields.key]
		}).onDelete('cascade'),
		check('field_states_value_check', sql`${table.value} IN ('learned', 'unlearned')`)
	]
);

/** Failed invite-code attempts, used for the 20-per-account-per-hour limit. */
export const inviteAttempts = sqliteTable(
	'invite_attempts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		telegramId: integer('telegram_id').notNull(),
		attemptedAt: integer('attempted_at').notNull()
	},
	(table) => [index('invite_attempts_lookup').on(table.telegramId, table.attemptedAt)]
);
