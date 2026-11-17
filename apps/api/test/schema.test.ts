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
import { writeTopicFieldStates } from '../src/store/field-states';

function freshDatabase() {
	const handle = openDatabase(':memory:');
	seedContent(handle.db);
	return handle;
}

describe('the SQLite schema keeps the domain invariants', () => {
	it('creates exactly six fields for a new topic and refuses to lose one', () => {
		const { db, close } = freshDatabase();
		db.insert(sections).values({ number: 26, name: 'Test section' }).run();
		const topic = db
			.insert(topics)
			.values({ sectionNumber: 26, position: 1, name: 'Test topic' })
			.returning({ id: topics.id })
			.get();

		const fields = db
			.select()
			.from(topicFields)
			.where(eq(topicFields.topicId, topic!.id))
			.all();

		expect(fields.map((field) => field.key).sort()).toEqual([...FIELD_KEYS].sort());
		expect(fields.every((field) => field.text === '' && !field.notApplicable)).toBe(true);

		expect(() =>
			db
				.delete(topicFields)
				.where(eq(topicFields.topicId, topic!.id))
				.run()
		).toThrow(/exactly six fields/);

		db.delete(topics).where(eq(topics.id, topic!.id)).run();
		expect(db.select().from(topicFields).where(eq(topicFields.topicId, topic!.id)).all()).toEqual(
			[]
		);
		close();
	});

	it('refuses a field key outside the six and a verdict outside learned/unlearned', () => {
		const { db, close } = freshDatabase();
		db.insert(sections).values({ number: 26, name: 'Test section' }).run();
		const topic = db
			.insert(topics)
			.values({ sectionNumber: 26, position: 1, name: 'Test topic' })
			.returning({ id: topics.id })
			.get();
		const account = db
			.insert(accounts)
			.values({ telegramId: 9001, displayName: 'Test', createdAt: 0 })
			.returning({ id: accounts.id })
			.get();

		expect(() =>
			db
				.insert(topicFields)
				.values({ topicId: topic!.id, key: 'extra' })
				.run()
		).toThrow();

		expect(() =>
			db
				.insert(fieldStates)
				.values({
					accountId: account!.id,
					topicId: topic!.id,
					fieldKey: 'what',
					value: 'maybe',
					gradedAt: 0
				})
				.run()
		).toThrow();
		close();
	});

	it('assigns a section to at most one group', () => {
		const { db, close } = freshDatabase();

		expect(() =>
			db.insert(groupSections).values({ groupName: 'B', sectionNumber: 1 }).run()
		).toThrow();
		close();
	});

	it('writes a whole topic atomically and leaves the old verdicts on failure', async () => {
		const { db, close } = freshDatabase();
		const account = db
			.insert(accounts)
			.values({ telegramId: 9002, displayName: 'Test', groupName: 'A', createdAt: 0 })
			.returning({ id: accounts.id })
			.get();
		const topic = db.select().from(topics).where(eq(topics.sectionNumber, 1)).get();

		writeTopicFieldStates(db, {
			accountId: account!.id,
			topicId: topic!.id,
			gradedAt: 100,
			states: { what: 'learned', when: 'learned' }
		});

		expect(
			db
				.select()
				.from(fieldStates)
				.where(eq(fieldStates.accountId, account!.id))
				.all()
		).toHaveLength(2);

		expect(() =>
			writeTopicFieldStates(db, {
				accountId: account!.id,
				topicId: topic!.id,
				gradedAt: 200,
				states: { what: 'unlearned', bogus: 'learned' } as never
			})
		).toThrow();

		const states = db
			.select()
			.from(fieldStates)
			.where(eq(fieldStates.accountId, account!.id))
			.all();
		expect(states.map((state) => [state.fieldKey, state.value]).sort()).toEqual([
			['what', 'learned'],
			['when', 'learned']
		]);
		close();
	});
});
