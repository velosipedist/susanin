import { and, eq } from 'drizzle-orm';
import {
	buildRun,
	buildSectionRun,
	gradeableFields,
	isFieldKey,
	isSide,
	selectedSectionNumbers,
	verdictsMatchCard,
	type CardFieldInput,
	type FieldKey,
	type GroupRunKind,
	type Run,
	type RunSectionInput,
	type SectionRun,
	type TopicInput,
	type Verdicts
} from '@susanin/shared';
import type { SusaninDatabase } from './db';
import { fieldStates, groupSections, sections, topicFields, topics } from './db/schema';
import { writeTopicFieldStates } from './store/field-states';

type TopicAccumulator = {
	id: number;
	position: number;
	name: string;
	side: TopicInput['side'];
	fields: CardFieldInput[];
};

type TopicFieldRow = {
	key: string | null;
	text: string | null;
	notApplicable: boolean | null;
};

type TopicRow = TopicFieldRow & {
	topicId: number | null;
	position: number | null;
	name: string | null;
	side: string | null;
};

/** Maps a joined topic-field row to a card field, or null when the join found none. */
function toCardFieldInput(row: TopicFieldRow): CardFieldInput | null {
	if (!isFieldKey(row.key)) return null;

	return {
		key: row.key,
		text: row.text ?? '',
		notApplicable: row.notApplicable ?? false
	};
}

/** Adds one joined row's field to its topic, creating the topic on first sight. */
function addTopicFieldRow(byTopic: Map<number, TopicAccumulator>, row: TopicRow): void {
	if (row.topicId === null) return;

	let topic = byTopic.get(row.topicId);
	if (!topic) {
		topic = {
			id: row.topicId,
			position: row.position ?? 0,
			name: row.name ?? '',
			side: isSide(row.side) ? row.side : null,
			fields: []
		};
		byTopic.set(row.topicId, topic);
	}

	const field = toCardFieldInput(row);
	if (field) topic.fields.push(field);
}

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
	for (const row of rows) addTopicFieldRow(byTopic, row);

	return buildSectionRun(section, [...byTopic.values()]);
}

type SectionAccumulator = {
	section: { number: number; name: string };
	topics: Map<number, TopicAccumulator>;
};

/**
 * Reads every section in a group, then flattens the selected ones into one run.
 * Learn new takes all five; Repeat takes only sections where the account still
 * has an Unlearned field. Empty and not-applicable fields never count as gaps.
 */
export function loadGroupRun(
	db: SusaninDatabase,
	input: { accountId: number; group: string; kind: GroupRunKind }
): Run {
	const rows = db
		.select({
			sectionNumber: sections.number,
			sectionName: sections.name,
			topicId: topics.id,
			position: topics.position,
			name: topics.name,
			side: topics.side,
			key: topicFields.key,
			text: topicFields.text,
			notApplicable: topicFields.notApplicable
		})
		.from(sections)
		.innerJoin(groupSections, eq(groupSections.sectionNumber, sections.number))
		.leftJoin(topics, eq(topics.sectionNumber, sections.number))
		.leftJoin(topicFields, eq(topicFields.topicId, topics.id))
		.where(eq(groupSections.groupName, input.group))
		.orderBy(sections.number, topics.position)
		.all();

	const bySection = new Map<number, SectionAccumulator>();

	for (const row of rows) {
		let accumulator = bySection.get(row.sectionNumber);
		if (!accumulator) {
			accumulator = {
				section: { number: row.sectionNumber, name: row.sectionName },
				topics: new Map()
			};
			bySection.set(row.sectionNumber, accumulator);
		}

		addTopicFieldRow(accumulator.topics, row);
	}

	const unlearnedByTopic = loadUnlearnedFields(db, input.accountId);

	const summaries = [...bySection.values()].map((accumulator) => ({
		number: accumulator.section.number,
		unlearned: countUnlearned(accumulator, unlearnedByTopic)
	}));

	const selected = new Set(selectedSectionNumbers(input.kind, summaries));
	const runSections: RunSectionInput[] = [...bySection.values()]
		.filter((accumulator) => selected.has(accumulator.section.number))
		.map((accumulator) => ({
			section: accumulator.section,
			topics: [...accumulator.topics.values()]
		}));

	return buildRun(input.kind, runSections);
}

/** Unlearned verdicts for one account, grouped by topic. */
function loadUnlearnedFields(
	db: SusaninDatabase,
	accountId: number
): Map<number, Set<FieldKey>> {
	const rows = db
		.select({ topicId: fieldStates.topicId, fieldKey: fieldStates.fieldKey })
		.from(fieldStates)
		.where(and(eq(fieldStates.accountId, accountId), eq(fieldStates.value, 'unlearned')))
		.all();

	const byTopic = new Map<number, Set<FieldKey>>();
	for (const row of rows) {
		if (!isFieldKey(row.fieldKey)) continue;

		let keys = byTopic.get(row.topicId);
		if (!keys) {
			keys = new Set();
			byTopic.set(row.topicId, keys);
		}
		keys.add(row.fieldKey);
	}

	return byTopic;
}

/** Counts unlearned verdicts that sit on authored, applicable fields only. */
function countUnlearned(
	section: SectionAccumulator,
	unlearnedByTopic: Map<number, Set<FieldKey>>
): number {
	let count = 0;

	for (const topic of section.topics.values()) {
		const keys = unlearnedByTopic.get(topic.id);
		if (!keys) continue;

		for (const field of gradeableFields(topic.fields)) {
			if (keys.has(field.key)) count += 1;
		}
	}

	return count;
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
		fieldRows
			.map(toCardFieldInput)
			.filter((field): field is CardFieldInput => field !== null)
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
