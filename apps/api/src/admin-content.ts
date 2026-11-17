import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
	FIELD_KEYS,
	SIDES,
	isFieldKey,
	isSide,
	type AdminDraftField,
	type AdminDraftTopic,
	type AdminFieldDiff,
	type AdminSectionDiff,
	type AdminSectionDraft,
	type AdminSectionDraftBody,
	type AdminSectionReview,
	type AdminSectionSaveBody,
	type AdminTopicDiff,
	type FieldKey
} from '@susanin/shared';
import type { SusaninDatabase } from './db';
import { fieldStates, sections, topicFields, topics } from './db/schema';

const fieldDraftSchema = z.object({
	key: z.enum(FIELD_KEYS),
	text: z.string(),
	notApplicable: z.boolean()
});

const topicDraftSchema = z.object({
	id: z.number().int().positive(),
	name: z.string().trim().min(1).max(200),
	side: z.enum(SIDES).nullable(),
	fields: z.array(fieldDraftSchema).length(FIELD_KEYS.length)
});

/**
 * The editor's save body. A topic must carry exactly six distinct canonical
 * fields and a side the check constraint accepts; anything else is refused
 * before it can reach the database.
 */
export const sectionDraftBodySchema = z
	.object({
		name: z.string().trim().min(1).max(200),
		topics: z.array(topicDraftSchema).max(500),
		resetProgress: z.boolean().optional()
	})
	.superRefine((draft, ctx) => {
		const seenIds = new Set<number>();

		for (const [index, topic] of draft.topics.entries()) {
			if (seenIds.has(topic.id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['topics', index, 'id'],
					message: 'duplicate topic id'
				});
			}
			seenIds.add(topic.id);

			const keys = new Set(topic.fields.map((field) => field.key));
			if (keys.size !== FIELD_KEYS.length) {
				ctx.addIssue({
					code: 'custom',
					path: ['topics', index, 'fields'],
					message: 'exactly six distinct fields are required'
				});
			}
		}
	});

/** Reads one section with its ordered topics and their six fields. */
export function loadSectionDraft(
	db: SusaninDatabase,
	sectionNumber: number
): AdminSectionDraft | null {
	const section = db
		.select({ number: sections.number, name: sections.name })
		.from(sections)
		.where(eq(sections.number, sectionNumber))
		.get();
	if (!section) return null;

	const topicRows = db
		.select({
			id: topics.id,
			position: topics.position,
			name: topics.name,
			side: topics.side
		})
		.from(topics)
		.where(eq(topics.sectionNumber, sectionNumber))
		.orderBy(topics.position)
		.all();

	if (topicRows.length === 0) {
		return { section, topics: [] };
	}

	const fieldRows = db
		.select({
			topicId: topicFields.topicId,
			key: topicFields.key,
			text: topicFields.text,
			notApplicable: topicFields.notApplicable
		})
		.from(topicFields)
		.where(
			inArray(
				topicFields.topicId,
				topicRows.map((topic) => topic.id)
			)
		)
		.all();

	const fieldsByTopic = new Map<number, Map<FieldKey, AdminDraftField>>();
	for (const row of fieldRows) {
		if (!isFieldKey(row.key)) continue;

		let fields = fieldsByTopic.get(row.topicId);
		if (!fields) {
			fields = new Map();
			fieldsByTopic.set(row.topicId, fields);
		}
		fields.set(row.key, {
			key: row.key,
			text: row.text,
			notApplicable: row.notApplicable
		});
	}

	return {
		section,
		topics: topicRows.map((topic) => ({
			id: topic.id,
			name: topic.name,
			side: isSide(topic.side) ? topic.side : null,
			fields: FIELD_KEYS.map(
				(key): AdminDraftField =>
					fieldsByTopic.get(topic.id)?.get(key) ?? {
						key,
						text: '',
						notApplicable: false
					}
			)
		}))
	};
}

/**
 * A save carries the section's full topic list, so the draft must name exactly
 * the stored topics. Adding and deleting topics arrive in a later change.
 */
export function draftMatchesStoredTopics(
	stored: AdminSectionDraft,
	draft: AdminSectionDraftBody
): boolean {
	if (stored.topics.length !== draft.topics.length) return false;

	const storedIds = new Set(stored.topics.map((topic) => topic.id));
	return draft.topics.every((topic) => storedIds.has(topic.id));
}

/**
 * Content changes are a topic name, a field's text, or a field's
 * not-applicable flag. Reorder, side changes and a section rename are saved but
 * never prompt about progress.
 */
export function diffSectionDraft(
	stored: AdminSectionDraft,
	draft: AdminSectionDraftBody
): AdminSectionDiff {
	const previousById = new Map(stored.topics.map((topic) => [topic.id, topic]));
	const changedTopics: AdminTopicDiff[] = [];
	const sideChanges: AdminSectionDiff['sideChanges'] = [];

	for (const topic of draft.topics) {
		const previous = previousById.get(topic.id);
		if (!previous) continue;

		if (previous.side !== topic.side) {
			sideChanges.push({
				id: topic.id,
				previousSide: previous.side,
				side: topic.side
			});
		}

		const fields = diffFields(previous.fields, topic.fields);
		if (previous.name !== topic.name || fields.length > 0) {
			changedTopics.push({
				id: topic.id,
				previousName: previous.name,
				name: topic.name,
				fields
			});
		}
	}

	return {
		section: {
			number: stored.section.number,
			previousName: stored.section.name,
			name: draft.name
		},
		topics: changedTopics,
		reordered: !sameOrder(stored.topics, draft.topics),
		sideChanges
	};
}

function diffFields(
	previous: readonly AdminDraftField[],
	next: readonly AdminDraftField[]
): AdminFieldDiff[] {
	const previousByKey = new Map(previous.map((field) => [field.key, field]));
	const nextByKey = new Map(next.map((field) => [field.key, field]));
	const changed: AdminFieldDiff[] = [];

	for (const key of FIELD_KEYS) {
		const before = previousByKey.get(key);
		const after = nextByKey.get(key);
		if (!before || !after) continue;

		if (before.text !== after.text || before.notApplicable !== after.notApplicable) {
			changed.push({
				key,
				previousText: before.text,
				text: after.text,
				previousNotApplicable: before.notApplicable,
				notApplicable: after.notApplicable
			});
		}
	}

	return changed;
}

function sameOrder(previous: readonly AdminDraftTopic[], next: readonly AdminDraftTopic[]): boolean {
	if (previous.length !== next.length) return false;
	return previous.every((topic, index) => topic.id === next[index]?.id);
}

/**
 * The changed topics that already carry at least one verdict, plus the number
 * of distinct accounts holding those verdicts.
 */
export function loadAffectedProgress(
	db: SusaninDatabase,
	topicIds: readonly number[]
): { affectedTopicIds: number[]; affectedLearners: number } {
	if (topicIds.length === 0) {
		return { affectedTopicIds: [], affectedLearners: 0 };
	}

	const rows = db
		.select({ topicId: fieldStates.topicId, accountId: fieldStates.accountId })
		.from(fieldStates)
		.where(inArray(fieldStates.topicId, [...topicIds]))
		.all();

	const affectedTopicIds = new Set<number>();
	const affectedAccounts = new Set<number>();

	for (const row of rows) {
		affectedTopicIds.add(row.topicId);
		affectedAccounts.add(row.accountId);
	}

	return {
		affectedTopicIds: [...affectedTopicIds].sort((left, right) => left - right),
		affectedLearners: affectedAccounts.size
	};
}

/** The diff plus the progress it would invalidate, computed without writing. */
export function reviewSectionDraft(
	db: SusaninDatabase,
	stored: AdminSectionDraft,
	draft: AdminSectionDraftBody
): AdminSectionReview {
	const diff = diffSectionDraft(stored, draft);
	return {
		...diff,
		...loadAffectedProgress(
			db,
			diff.topics.map((topic) => topic.id)
		)
	};
}

export type SaveSectionResult =
	| { status: 'ok'; draft: AdminSectionDraft }
	| { status: 'not-found' }
	| { status: 'invalid-topics' }
	| { status: 'progress-affected'; review: AdminSectionReview };

/**
 * Diffs the full draft and writes it only when no changed topic carries a
 * verdict, or when the caller has explicitly chosen Keep or Reset after the
 * 409. Reset removes the affected topics' verdicts for every account; Keep
 * writes the content and leaves every verdict alone.
 */
export function saveSectionDraft(
	db: SusaninDatabase,
	sectionNumber: number,
	draft: AdminSectionSaveBody
): SaveSectionResult {
	const stored = loadSectionDraft(db, sectionNumber);
	if (!stored) return { status: 'not-found' };
	if (!draftMatchesStoredTopics(stored, draft)) return { status: 'invalid-topics' };

	const review = reviewSectionDraft(db, stored, draft);
	if (review.affectedTopicIds.length > 0 && draft.resetProgress === undefined) {
		return { status: 'progress-affected', review };
	}

	writeSectionDraft(
		db,
		sectionNumber,
		draft,
		draft.resetProgress ? review.affectedTopicIds : []
	);
	const saved = loadSectionDraft(db, sectionNumber);
	if (!saved) return { status: 'not-found' };

	return { status: 'ok', draft: saved };
}

/**
 * Writes a whole section in one transaction. Positions move through negatives
 * first so the unique (section, position) index never sees two equal values
 * during a reorder. When `resetTopicIds` is given, every verdict on those
 * topics is deleted for every account in the same transaction.
 */
export function writeSectionDraft(
	db: SusaninDatabase,
	sectionNumber: number,
	draft: AdminSectionDraftBody,
	resetTopicIds: readonly number[] = []
): void {
	db.transaction((tx) => {
		if (resetTopicIds.length > 0) {
			tx.delete(fieldStates)
				.where(inArray(fieldStates.topicId, [...resetTopicIds]))
				.run();
		}

		tx.update(sections)
			.set({ name: draft.name })
			.where(eq(sections.number, sectionNumber))
			.run();

		for (const [index, topic] of draft.topics.entries()) {
			tx.update(topics)
				.set({ position: -(index + 1) })
				.where(and(eq(topics.id, topic.id), eq(topics.sectionNumber, sectionNumber)))
				.run();
		}

		for (const [index, topic] of draft.topics.entries()) {
			tx.update(topics)
				.set({ position: index + 1, name: topic.name, side: topic.side })
				.where(and(eq(topics.id, topic.id), eq(topics.sectionNumber, sectionNumber)))
				.run();

			for (const field of topic.fields) {
				tx.update(topicFields)
					.set({ text: field.text, notApplicable: field.notApplicable })
					.where(and(eq(topicFields.topicId, topic.id), eq(topicFields.key, field.key)))
					.run();
			}
		}
	});
}
