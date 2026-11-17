import { and, eq, sql } from 'drizzle-orm';
import { FIELD_KEYS, GROUPS, type FieldKey, type Group, type Side } from '@susanin/shared';
import type { SusaninDatabase } from './index';
import { accounts, groupSections, groups, sections, topicFields, topics } from './schema';
import { writeTopicFieldStates } from '../store/field-states';

/**
 * Placeholder content until the Brief/Syllabus importer (issue #8) fills the
 * database. Names mirror the local demo; every field text is explicitly a
 * placeholder, never source material.
 */
const SECTION_NAMES: Record<number, string> = {
	1: 'Victoria Harbour',
	2: 'Star Ferry',
	3: "Queen's Pier",
	4: 'Convention Centre',
	5: 'Golden Bauhinia Square',
	6: 'Noonday Gun',
	7: 'Victoria Park',
	8: 'Tin Hau Temple',
	9: 'Jardine House',
	10: 'The Peak Tram',
	11: 'Peak Tower',
	12: 'Repulse Bay',
	13: 'Stanley Market',
	14: 'Murray House',
	15: 'Aberdeen Harbour',
	16: 'Ocean Park',
	17: 'Central District',
	18: 'Statue Square',
	19: 'The Cenotaph',
	20: 'Hong Kong Park',
	21: 'Bank of China Tower',
	22: 'Cheung Kong Centre',
	23: 'Lan Kwai Fong',
	24: 'Man Mo Temple',
	25: 'Happy Valley Racecourse'
};

/** Temporary A–E mapping until admins assign sections (issue #9). */
export const DEMO_GROUP_SECTIONS: Record<Group, number[]> = {
	A: [1, 2, 3, 4, 5],
	B: [6, 7, 8, 9, 10],
	C: [11, 12, 13, 14, 15],
	D: [16, 17, 18, 19, 20],
	E: [21, 22, 23, 24, 25]
};

const TOPICS_PER_SECTION = 3;

export function seedContent(db: SusaninDatabase): void {
	db.transaction((tx) => {
		for (const group of GROUPS) {
			tx.insert(groups).values({ name: group }).onConflictDoNothing().run();
		}

		for (const [number, name] of Object.entries(SECTION_NAMES)) {
			const sectionNumber = Number(number);

			tx.insert(sections).values({ number: sectionNumber, name }).onConflictDoNothing().run();

			const group = groupForSection(sectionNumber);
			if (group) {
				tx.insert(groupSections)
					.values({ groupName: group, sectionNumber })
					.onConflictDoNothing()
					.run();
			}

			const existing = tx
				.select({ count: sql<number>`count(*)` })
				.from(topics)
				.where(eq(topics.sectionNumber, sectionNumber))
				.get();

			if ((existing?.count ?? 0) > 0) continue;

			for (let position = 1; position <= TOPICS_PER_SECTION; position += 1) {
				const topicName = `${name} · Placeholder ${position}`;
				const inserted = tx
					.insert(topics)
					.values({ sectionNumber, position, name: topicName, side: sideFor(position) })
					.returning({ id: topics.id })
					.get();

				if (!inserted) continue;

				for (const key of FIELD_KEYS) {
					tx.update(topicFields)
						.set({ text: `Placeholder ${key} for ${topicName}.` })
						.where(and(eq(topicFields.topicId, inserted.id), eq(topicFields.key, key)))
						.run();
				}
			}
		}
	});
}

/**
 * A local demo account so a plain browser can check the home screen without a
 * Telegram client. Only used when DEV_AUTH is enabled; never seeded in tests or
 * production.
 */
export function seedDemoAccount(
	db: SusaninDatabase,
	input: { telegramId: number; displayName: string; group: Group; now: number }
): number {
	const existing = db
		.select()
		.from(accounts)
		.where(eq(accounts.telegramId, input.telegramId))
		.get();

	const accountId =
		existing?.id ??
		(db
			.insert(accounts)
			.values({
				telegramId: input.telegramId,
				displayName: input.displayName,
				groupName: input.group,
				isAdmin: false,
				createdAt: input.now
			})
			.returning({ id: accounts.id })
			.get()?.id as number);

	const sectionNumbers = DEMO_GROUP_SECTIONS[input.group];
	const topicRows = db
		.select({ id: topics.id, position: topics.position, sectionNumber: topics.sectionNumber })
		.from(topics)
		.all()
		.filter((topic) => sectionNumbers.includes(topic.sectionNumber))
		.sort((a, b) => a.sectionNumber - b.sectionNumber || a.position - b.position);

	for (const topic of topicRows) {
		if (topic.position > 2) continue;

		const states: Partial<Record<FieldKey, 'learned' | 'unlearned'>> = {};
		for (const [index, key] of FIELD_KEYS.entries()) {
			if (topic.position === 1) {
				states[key] = 'learned';
			} else {
				states[key] = index < 4 ? 'learned' : 'unlearned';
			}
		}

		writeTopicFieldStates(db, {
			accountId,
			topicId: topic.id,
			gradedAt: input.now,
			states
		});
	}

	return accountId;
}

function groupForSection(sectionNumber: number): Group | undefined {
	return GROUPS.find((group) => DEMO_GROUP_SECTIONS[group].includes(sectionNumber));
}

function sideFor(position: number): Side {
	if (position === 1) return 'left';
	if (position === 2) return 'supplementary';
	return 'right';
}
