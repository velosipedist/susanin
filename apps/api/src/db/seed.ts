import { and, eq, sql } from 'drizzle-orm';
import { FIELD_KEYS, GROUPS, type Group, type Side } from '@susanin/shared';
import type { SusaninDatabase } from './index';
import { accounts, groupSections, groups, sections, topicFields, topics } from './schema';
import { writeTopicFieldStates, type TopicFieldStates } from '../store/field-states';

/**
 * Placeholder content until the Brief/Syllabus importer (issue #8) fills the
 * database. Names mirror the local demo; every field text is explicitly a
 * placeholder, never source material.
 */
const SECTION_NAMES = [
	'Victoria Harbour',
	'Star Ferry',
	"Queen's Pier",
	'Convention Centre',
	'Golden Bauhinia Square',
	'Noonday Gun',
	'Victoria Park',
	'Tin Hau Temple',
	'Jardine House',
	'The Peak Tram',
	'Peak Tower',
	'Repulse Bay',
	'Stanley Market',
	'Murray House',
	'Aberdeen Harbour',
	'Ocean Park',
	'Central District',
	'Statue Square',
	'The Cenotaph',
	'Hong Kong Park',
	'Bank of China Tower',
	'Cheung Kong Centre',
	'Lan Kwai Fong',
	'Man Mo Temple',
	'Happy Valley Racecourse'
];

/** Temporary A–E mapping for a fresh database; admins change it in the app. */
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

		// The demo A–E mapping belongs to a brand-new database only. Once any
		// section exists, the stored map wins and a restart must not recreate a
		// mapping an admin has changed or cleared.
		const existingSections = tx
			.select({ count: sql<number>`count(*)` })
			.from(sections)
			.get();
		const seedGroupAssignments = (existingSections?.count ?? 0) === 0;

		for (const [index, name] of SECTION_NAMES.entries()) {
			const sectionNumber = index + 1;

			tx.insert(sections).values({ number: sectionNumber, name }).onConflictDoNothing().run();

			const group = groupForSection(sectionNumber);
			if (group && seedGroupAssignments) {
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
	if (existing) return existing.id;

	const inserted = db
		.insert(accounts)
		.values({
			telegramId: input.telegramId,
			displayName: input.displayName,
			groupName: input.group,
			isAdmin: false,
			createdAt: input.now
		})
		.returning({ id: accounts.id })
		.get();
	if (!inserted) throw new Error('Could not create the demo account.');

	const accountId = inserted.id;
	const sectionNumbers = DEMO_GROUP_SECTIONS[input.group];
	const topicRows = db
		.select({ id: topics.id, position: topics.position, sectionNumber: topics.sectionNumber })
		.from(topics)
		.all()
		.filter((topic) => sectionNumbers.includes(topic.sectionNumber))
		.sort((a, b) => a.sectionNumber - b.sectionNumber || a.position - b.position);

	for (const topic of topicRows) {
		if (topic.position > 2) continue;

		const states: TopicFieldStates = {};
		for (const [index, key] of FIELD_KEYS.entries()) {
			states[key] = topic.position === 1 || index < 4 ? 'learned' : 'unlearned';
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
