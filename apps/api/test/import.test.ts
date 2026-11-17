import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { FIELD_KEYS } from '@susanin/shared';
import { openDatabase } from '../src/db';
import {
	accounts,
	fieldStates,
	groupSections,
	sections,
	topicFields,
	topics
} from '../src/db/schema';
import { seedContent } from '../src/db/seed';
import { importContent, ImportBlockedError } from '../src/import/import-content';
import { parseBrief } from '../src/import/brief';
import { planImport } from '../src/import/plan';
import { formatReport } from '../src/import/report';
import { parseSyllabus } from '../src/import/syllabus';
import { writeTopicFieldStates } from '../src/store/field-states';

const briefText = readFileSync(new URL('./fixtures/brief.txt', import.meta.url), 'utf8');
const syllabusText = readFileSync(new URL('./fixtures/syllabus.txt', import.meta.url), 'utf8');

describe('parsing the Brief', () => {
	it('reads sections in number order and topic headings in document order', () => {
		expect(parseBrief(briefText)).toEqual([
			{
				number: 1,
				title: 'Victoria Harbour',
				topicNames: ['Star Ferry', 'Clock Tower', 'Harbour View']
			},
			{
				number: 2,
				title: 'Central District',
				topicNames: ['Statue Square', 'The Cenotaph']
			},
			{ number: 3, title: 'The Peak', topicNames: ['Peak Tram'] }
		]);
	});
});

describe('parsing the Syllabus', () => {
	it('keeps the three columns and assigns each item its side', () => {
		expect(parseSyllabus(syllabusText)).toEqual([
			{
				number: 1,
				title: 'Victoria Harbour',
				items: [
					{ name: 'STAR FERRIES', side: 'left' },
					{ name: 'clock tower.', side: 'right' },
					{ name: 'Noonday Gun', side: 'right' }
				]
			},
			{
				number: 2,
				title: 'Central District',
				items: [
					{ name: 'Statue Squar', side: 'left' },
					{ name: 'The Cenotaph.', side: 'right' }
				]
			},
			{
				number: 4,
				title: 'Repulse Bay',
				items: [{ name: 'Repulse Bay Beach', side: 'left' }]
			}
		]);
	});
});

describe('planning an import', () => {
	it('applies only exact normalized matches and appends Syllabus-only topics', () => {
		const { sections: planned, report } = planImport(
			parseBrief(briefText),
			parseSyllabus(syllabusText)
		);

		expect(planned.map((section) => section.number)).toEqual([1, 2, 3, 4]);

		expect(planned[0]).toEqual({
			number: 1,
			name: 'Victoria Harbour',
			topics: [
				{ name: 'Star Ferry', side: 'left', notApplicable: false },
				{ name: 'Clock Tower', side: 'right', notApplicable: false },
				{ name: 'Harbour View', side: null, notApplicable: false },
				{ name: 'Noonday Gun', side: 'right', notApplicable: true }
			]
		});

		// "Statue Squar" is only a fuzzy match, so the Brief topic keeps no side
		// and the Syllabus item is appended instead of being treated as the same topic.
		expect(planned[1]).toEqual({
			number: 2,
			name: 'Central District',
			topics: [
				{ name: 'Statue Square', side: null, notApplicable: false },
				{ name: 'The Cenotaph', side: 'right', notApplicable: false },
				{ name: 'Statue Squar', side: 'left', notApplicable: true }
			]
		});

		expect(planned[2].topics).toEqual([
			{ name: 'Peak Tram', side: null, notApplicable: false }
		]);
		expect(planned[3].topics).toEqual([
			{ name: 'Repulse Bay Beach', side: 'left', notApplicable: true }
		]);

		expect(report.matched).toEqual([
			{ sectionNumber: 1, briefName: 'Star Ferry', syllabusName: 'STAR FERRIES', side: 'left' },
			{
				sectionNumber: 1,
				briefName: 'Clock Tower',
				syllabusName: 'clock tower.',
				side: 'right'
			},
			{
				sectionNumber: 2,
				briefName: 'The Cenotaph',
				syllabusName: 'The Cenotaph.',
				side: 'right'
			}
		]);
		expect(report.unmatched).toEqual([
			{ sectionNumber: 1, briefName: 'Harbour View' },
			{ sectionNumber: 2, briefName: 'Statue Square' },
			{ sectionNumber: 3, briefName: 'Peak Tram' }
		]);
		expect(report.appended).toEqual([
			{ sectionNumber: 1, syllabusName: 'Noonday Gun', side: 'right' },
			{ sectionNumber: 2, syllabusName: 'Statue Squar', side: 'left' },
			{ sectionNumber: 4, syllabusName: 'Repulse Bay Beach', side: 'left' }
		]);
		expect(report.ambiguous).toHaveLength(1);
		expect(report.ambiguous[0].sectionNumber).toBe(2);
		expect(report.ambiguous[0].briefName).toBe('Statue Square');
		expect(report.ambiguous[0].syllabusName).toBe('Statue Squar');
		expect(report.ambiguous[0].score).toBeGreaterThan(0.8);
	});

	it('reports every match, gap and appended item for review', () => {
		const { report } = planImport(parseBrief(briefText), parseSyllabus(syllabusText));
		const output = formatReport(report);

		expect(output).toContain('Matched (3)');
		expect(output).toContain('Section 1: Star Ferry — "STAR FERRIES" (left)');
		expect(output).toContain('Unmatched Brief topics, side unset (3)');
		expect(output).toContain('Section 1: Harbour View');
		expect(output).toContain('Appended Syllabus-only topics (3)');
		expect(output).toContain('Section 4: Repulse Bay Beach (left)');
		expect(output).toContain('Ambiguous candidates, not applied (1)');
		expect(output).toContain('Section 2: Statue Square ~ "Statue Squar"');
	});
});

describe('importing into SQLite', () => {
	it('writes sections, ordered topics, and six fields per topic', () => {
		const { db, close } = openDatabase(':memory:');

		const report = importContent({ db, briefText, syllabusText, reset: false });

		expect(report.sectionCount).toBe(4);
		expect(db.select().from(sections).orderBy(sections.number).all()).toEqual([
			{ number: 1, name: 'Victoria Harbour' },
			{ number: 2, name: 'Central District' },
			{ number: 3, name: 'The Peak' },
			{ number: 4, name: 'Repulse Bay' }
		]);

		const sectionOneTopics = db
			.select()
			.from(topics)
			.where(eq(topics.sectionNumber, 1))
			.orderBy(topics.position)
			.all();
		expect(sectionOneTopics.map((topic) => [topic.name, topic.side])).toEqual([
			['Star Ferry', 'left'],
			['Clock Tower', 'right'],
			['Harbour View', null],
			['Noonday Gun', 'right']
		]);

		for (const topic of sectionOneTopics) {
			const fields = db
				.select()
				.from(topicFields)
				.where(eq(topicFields.topicId, topic.id))
				.all();
			expect(fields.map((field) => field.key).sort()).toEqual([...FIELD_KEYS].sort());
		}

		const noonday = sectionOneTopics.find((topic) => topic.name === 'Noonday Gun');
		const noondayFields = db
			.select()
			.from(topicFields)
			.where(eq(topicFields.topicId, noonday!.id))
			.all();
		expect(noondayFields.every((field) => field.notApplicable && field.text === '')).toBe(true);

		const starFerry = sectionOneTopics.find((topic) => topic.name === 'Star Ferry');
		const starFerryFields = db
			.select()
			.from(topicFields)
			.where(eq(topicFields.topicId, starFerry!.id))
			.all();
		expect(starFerryFields.every((field) => !field.notApplicable && field.text === '')).toBe(true);

		close();
	});

	it('refuses to import when any field state exists, then resets content and states on demand', () => {
		const { db, close } = openDatabase(':memory:');
		seedContent(db);

		const account = db
			.insert(accounts)
			.values({ telegramId: 9100, displayName: 'Test', createdAt: 0 })
			.returning({ id: accounts.id })
			.get();
		const topic = db.select().from(topics).where(eq(topics.sectionNumber, 1)).get();

		writeTopicFieldStates(db, {
			accountId: account!.id,
			topicId: topic!.id,
			gradedAt: 1,
			states: { what: 'learned' }
		});

		const topicsBefore = db.select().from(topics).all().length;

		expect(() => importContent({ db, briefText, syllabusText, reset: false })).toThrow(
			ImportBlockedError
		);
		expect(db.select().from(topics).all()).toHaveLength(topicsBefore);
		expect(db.select().from(fieldStates).all()).toHaveLength(1);

		importContent({ db, briefText, syllabusText, reset: true });

		expect(db.select().from(fieldStates).all()).toEqual([]);
		expect(db.select().from(topics).all()).toHaveLength(9);
		expect(
			db.select().from(groupSections).where(eq(groupSections.groupName, 'A')).all()
		).toHaveLength(5);
		close();
	});
});
