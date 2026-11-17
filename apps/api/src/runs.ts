import { eq } from 'drizzle-orm';
import {
	buildSectionRun,
	gradeableFields,
	isSide,
	verdictsMatchCard,
	type CardFieldInput,
	type FieldKey,
	type SectionRun,
	type TopicInput,
	type Verdicts
} from '@susanin/shared';
import type { SusaninDatabase } from './db';
import { sections, topicFields, topics } from './db/schema';
import { writeTopicFieldStates } from './store/field-states';

type TopicAccumulator = {
	id: number;
	position: number;
	name: string;
	side: TopicInput['side'];
	fields: CardFieldInput[];
};

/** Reads one section's route and drops every topic that has no gradeable field. */
export function loadSectionRun(
	db: SusaninDatabase,
	sectionNumber: number
): SectionRun | undefined {
	const section = db
		.select({ number: sections.number, name: sections.name })
		.from(sections)
		.where(eq(sections.number, sectionNumber))
		.get();
	if (!section) return undefined;

	const rows = db
		.select({
			topicId: topics.id,
			position: topics.position,
			name: topics.name,
			side: topics.side,
			key: topicFields.key,
			text: topicFields.text,
			notApplicable: topicFields.notApplicable
		})
		.from(topics)
		.leftJoin(topicFields, eq(topicFields.topicId, topics.id))
		.where(eq(topics.sectionNumber, sectionNumber))
		.orderBy(topics.position)
		.all();

	const byTopic = new Map<number, TopicAccumulator>();
	for (const row of rows) {
		let topic = byTopic.get(row.topicId);
		if (!topic) {
			topic = {
				id: row.topicId,
				position: row.position,
				name: row.name,
				side: isSide(row.side) ? row.side : null,
				fields: []
			};
			byTopic.set(row.topicId, topic);
		}

		if (row.key !== null) {
			topic.fields.push({
				key: row.key as FieldKey,
				text: row.text ?? '',
				notApplicable: row.notApplicable ?? false
			});
		}
	}

	return buildSectionRun(section, [...byTopic.values()]);
}

export type GradeTopicResult =
	| { status: 'ok' }
	| { status: 'not-found' }
	| { status: 'no-fields' }
	| { status: 'incomplete' };

/**
 * Writes a whole topic's verdicts or nothing. A partial card, an unknown field
 * or a field that is empty or not applicable is refused before any write.
 */
export function gradeTopic(
	db: SusaninDatabase,
	input: {
		accountId: number;
		topicId: number;
		gradedAt: number;
		verdicts: Verdicts;
	}
): GradeTopicResult {
	const topic = db
		.select({ id: topics.id })
		.from(topics)
		.where(eq(topics.id, input.topicId))
		.get();
	if (!topic) return { status: 'not-found' };

	const fieldRows = db
		.select({
			key: topicFields.key,
			text: topicFields.text,
			notApplicable: topicFields.notApplicable
		})
		.from(topicFields)
		.where(eq(topicFields.topicId, input.topicId))
		.all();

	const fields = gradeableFields(
		fieldRows.map((field) => ({
			key: field.key as FieldKey,
			text: field.text,
			notApplicable: field.notApplicable
		}))
	);

	if (fields.length === 0) return { status: 'no-fields' };
	if (!verdictsMatchCard(fields, input.verdicts)) return { status: 'incomplete' };

	writeTopicFieldStates(db, {
		accountId: input.accountId,
		topicId: input.topicId,
		gradedAt: input.gradedAt,
		states: input.verdicts
	});

	return { status: 'ok' };
}
