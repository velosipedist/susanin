import { and, eq, ne, sql } from 'drizzle-orm';
import type {
	Group,
	HomeResponse,
	SectionListItem,
	SectionListResponse,
	SectionProgress
} from '@susanin/shared';
import type { SusaninDatabase } from './db';
import { fieldStates, groupSections, sections, topicFields, topics } from './db/schema';

type ProgressRow = {
	number: number;
	name: string;
	groupName: string | null;
	key: string | null;
	value: string | null;
};

type SectionAccumulator = {
	progress: SectionProgress;
	groupName: string | null;
};

/**
 * One row per authored, applicable field with the account's verdict. A section
 * without topics (and a topic without fields) still produces one row, so every
 * selected section appears even when it has nothing to train yet.
 */
function loadProgressRows(db: SusaninDatabase, accountId: number, group?: Group): ProgressRow[] {
	return db
		.select({
			number: sections.number,
			name: sections.name,
			groupName: groupSections.groupName,
			key: topicFields.key,
			value: fieldStates.value
		})
		.from(sections)
		.leftJoin(groupSections, eq(groupSections.sectionNumber, sections.number))
		.leftJoin(topics, eq(topics.sectionNumber, sections.number))
		.leftJoin(
			topicFields,
			and(
				eq(topicFields.topicId, topics.id),
				eq(topicFields.notApplicable, false),
				ne(topicFields.text, '')
			)
		)
		.leftJoin(
			fieldStates,
			and(
				eq(fieldStates.accountId, accountId),
				eq(fieldStates.topicId, topics.id),
				eq(fieldStates.fieldKey, topicFields.key)
			)
		)
		.where(group ? eq(groupSections.groupName, group) : undefined)
		.orderBy(sections.number)
		.all();
}

function accumulateProgress(rows: ProgressRow[]): Map<number, SectionAccumulator> {
	const bySection = new Map<number, SectionAccumulator>();

	for (const row of rows) {
		let section = bySection.get(row.number);
		if (!section) {
			section = {
				progress: {
					number: row.number,
					name: row.name,
					learned: 0,
					unlearned: 0,
					untouched: 0
				},
				groupName: row.groupName
			};
			bySection.set(row.number, section);
		}

		if (row.key === null) continue;

		if (row.value === 'learned') section.progress.learned += 1;
		else if (row.value === 'unlearned') section.progress.unlearned += 1;
		else section.progress.untouched += 1;
	}

	return bySection;
}

function sortByNumber<T extends { number: number }>(items: T[]): T[] {
	return items.sort((left, right) => left.number - right.number);
}

export function loadHome(
	db: SusaninDatabase,
	account: { id: number; displayName: string },
	group: Group
): HomeResponse {
	const progress = [...accumulateProgress(loadProgressRows(db, account.id, group)).values()].map(
		(section) => section.progress
	);

	const total = db.select({ count: sql<number>`count(*)` }).from(sections).get();

	return {
		account: {
			firstName: account.displayName,
			group
		},
		sections: sortByNumber(progress),
		totalSections: total?.count ?? 0
	};
}

/** Every section in route order, with the learner's group marked in scope. */
export function loadSectionList(
	db: SusaninDatabase,
	account: { id: number; displayName: string },
	group: Group
): SectionListResponse {
	const sections: SectionListItem[] = [
		...accumulateProgress(loadProgressRows(db, account.id)).values()
	].map(({ progress, groupName }) => ({
		...progress,
		inScope: groupName === group
	}));

	return {
		account: {
			firstName: account.displayName,
			group
		},
		sections: sortByNumber(sections)
	};
}
