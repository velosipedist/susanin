import { and, eq, ne, sql } from 'drizzle-orm';
import type { Group, HomeResponse, SectionProgress } from '@susanin/shared';
import type { SusaninDatabase } from './db';
import { fieldStates, groupSections, sections, topicFields, topics } from './db/schema';

export function loadHome(
	db: SusaninDatabase,
	account: { id: number; displayName: string },
	group: Group
): HomeResponse {
	const progress = new Map<number, SectionProgress>();

	const rows = db
		.select({
			number: sections.number,
			name: sections.name,
			key: topicFields.key,
			value: fieldStates.value
		})
		.from(sections)
		.innerJoin(groupSections, eq(groupSections.sectionNumber, sections.number))
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
				eq(fieldStates.accountId, account.id),
				eq(fieldStates.topicId, topics.id),
				eq(fieldStates.fieldKey, topicFields.key)
			)
		)
		.where(eq(groupSections.groupName, group))
		.orderBy(sections.number)
		.all();

	for (const row of rows) {
		let section = progress.get(row.number);
		if (!section) {
			section = {
				number: row.number,
				name: row.name,
				learned: 0,
				unlearned: 0,
				untouched: 0
			};
			progress.set(row.number, section);
		}

		if (row.key === null) continue;

		if (row.value === 'learned') section.learned += 1;
		else if (row.value === 'unlearned') section.unlearned += 1;
		else section.untouched += 1;
	}

	const total = db.select({ count: sql<number>`count(*)` }).from(sections).get();

	return {
		account: {
			firstName: account.displayName,
			group
		},
		sections: [...progress.values()].sort((left, right) => left.number - right.number),
		totalSections: total?.count ?? 0
	};
}
