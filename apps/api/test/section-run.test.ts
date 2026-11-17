import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	FIELD_KEYS,
	buildSectionRun,
	gradeableFields,
	leaveAction,
	verdictsMatchCard,
	type FieldKey,
	type FieldStateValue,
	type SectionRun,
	type Verdicts
} from '@susanin/shared';
import { accounts, fieldStates, topicFields, topics } from '../src/db/schema';
import { cookieForLearner, createTestApi, getHome, type TestApi } from './helpers';

async function cardsFor(api: TestApi, cookie: string, section = 6) {
	const response = await api.app.request(`/api/sections/${section}/cards`, {
		headers: { cookie }
	});
	expect(response.status).toBe(200);
	return (await response.json()) as SectionRun;
}

async function grade(
	api: TestApi,
	cookie: string,
	topicId: number,
	verdicts: Verdicts
): Promise<Response> {
	return api.app.request(`/api/topics/${topicId}/progress`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify({ verdicts })
	});
}

function allVerdicts(keys: readonly FieldKey[], value: FieldStateValue = 'learned'): Verdicts {
	const verdicts: Verdicts = {};
	for (const key of keys) verdicts[key] = value;
	return verdicts;
}

describe('section cards over HTTP', () => {
	it('returns the section topics in route order with six fields each', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8001);

		const run = await cardsFor(api, cookie);

		expect(run.section).toEqual({ number: 6, name: 'Noonday Gun' });
		expect(run.topicCount).toBe(3);
		expect(run.cards.map((card) => card.position)).toEqual([1, 2, 3]);
		expect(run.cards[0].fields.map((field) => field.key)).toEqual([...FIELD_KEYS]);
		api.close();
	});

	it('hides not-applicable and empty fields, and skips a topic with no gradeable field', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8002);

		const first = api.db
			.select()
			.from(topics)
			.where(eq(topics.sectionNumber, 6))
			.orderBy(topics.position)
			.get();

		api.db
			.update(topicFields)
			.set({ notApplicable: true })
			.where(and(eq(topicFields.topicId, first!.id), eq(topicFields.key, 'what')))
			.run();
		api.db
			.update(topicFields)
			.set({ text: '' })
			.where(and(eq(topicFields.topicId, first!.id), eq(topicFields.key, 'when')))
			.run();

		const empty = api.db
			.insert(topics)
			.values({ sectionNumber: 6, position: 4, name: 'No facts yet', side: null })
			.returning({ id: topics.id })
			.get();
		expect(empty).toBeDefined();

		const run = await cardsFor(api, cookie);

		expect(run.topicCount).toBe(4);
		expect(run.cards).toHaveLength(3);
		expect(run.cards[0].fields.map((field) => field.key)).toEqual(['where', 'why', 'who', 'how']);
		expect(run.cards.some((card) => card.id === empty!.id)).toBe(false);
		api.close();
	});

	it('rejects readers without a session', async () => {
		const api = createTestApi();

		const read = await api.app.request('/api/sections/6/cards');
		const write = await api.app.request('/api/topics/1/progress', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ verdicts: {} })
		});

		expect(read.status).toBe(401);
		expect(write.status).toBe(401);
		api.close();
	});
});

describe('writing a whole topic over HTTP', () => {
	it('writes every verdict in one transaction and moves the home counts', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8003);

		const run = await cardsFor(api, cookie);
		const card = run.cards[0];
		const verdicts: Verdicts = { ...allVerdicts(FIELD_KEYS), why: 'unlearned' };

		const response = await grade(api, cookie, card.id, verdicts);
		expect(response.status).toBe(200);

		const account = api.db.select({ id: accounts.id }).from(accounts).get();
		const states = api.db
			.select()
			.from(fieldStates)
			.where(eq(fieldStates.accountId, account!.id))
			.all();

		expect(states).toHaveLength(6);
		expect(states.every((state) => state.gradedAt === api.config.now())).toBe(true);
		expect(states.map((state) => [state.fieldKey, state.value]).sort()).toEqual([
			['how', 'learned'],
			['what', 'learned'],
			['when', 'learned'],
			['where', 'learned'],
			['who', 'learned'],
			['why', 'unlearned']
		]);

		const home = (await (await getHome(api, cookie)).json()) as {
			sections: { number: number; learned: number; unlearned: number; untouched: number }[];
		};
		expect(home.sections.find((section) => section.number === 6)).toMatchObject({
			learned: 5,
			unlearned: 1,
			untouched: 12
		});
		api.close();
	});

	it('refuses a partial card and writes nothing', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8004);

		const run = await cardsFor(api, cookie);
		const card = run.cards[0];

		const response = await grade(api, cookie, card.id, { what: 'learned', when: 'learned' });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'incomplete-card' });
		expect(api.db.select().from(fieldStates).all()).toEqual([]);
		api.close();
	});

	it('refuses a verdict for a not-applicable field and keeps the old states', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8005);

		const run = await cardsFor(api, cookie);
		const card = run.cards[0];

		const saved = await grade(api, cookie, card.id, allVerdicts(FIELD_KEYS));
		expect(saved.status).toBe(200);

		api.db
			.update(topicFields)
			.set({ notApplicable: true })
			.where(and(eq(topicFields.topicId, card.id), eq(topicFields.key, 'what')))
			.run();

		const refused = await grade(api, cookie, card.id, allVerdicts(FIELD_KEYS));
		expect(refused.status).toBe(400);

		const account = api.db.select({ id: accounts.id }).from(accounts).get();
		const states = api.db
			.select()
			.from(fieldStates)
			.where(eq(fieldStates.accountId, account!.id))
			.all();

		expect(states).toHaveLength(6);
		api.close();
	});

	it('returns 404 for an unknown topic and 400 when the topic has no gradeable field', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8006);

		const unknown = await grade(api, cookie, 99_999, { what: 'learned' });
		expect(unknown.status).toBe(404);

		const empty = api.db
			.insert(topics)
			.values({ sectionNumber: 6, position: 4, name: 'No facts yet', side: null })
			.returning({ id: topics.id })
			.get();

		const response = await grade(api, cookie, empty!.id, {});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'no-gradeable-fields' });
		api.close();
	});
});

describe('card domain rules', () => {
	it('keeps only authored, applicable fields in canonical order', () => {
		const fields = gradeableFields([
			{ key: 'how', text: 'By ferry', notApplicable: false },
			{ key: 'what', text: '  ', notApplicable: false },
			{ key: 'when', text: '1898', notApplicable: true },
			{ key: 'where', text: 'Central', notApplicable: false }
		]);

		expect(fields).toEqual([
			{ key: 'where', text: 'Central' },
			{ key: 'how', text: 'By ferry' }
		]);
	});

	it('orders cards by position and drops topics with no gradeable field', () => {
		const run = buildSectionRun(
			{ number: 7, name: 'Test' },
			[
				{ id: 2, position: 2, name: 'Second', side: 'right', fields: [] },
				{
					id: 1,
					position: 1,
					name: 'First',
					side: 'left',
					fields: [{ key: 'what', text: 'A clock', notApplicable: false }]
				}
			]
		);

		expect(run.topicCount).toBe(2);
		expect(run.cards.map((card) => card.name)).toEqual(['First']);
	});

	it('classifies leaving as write, confirm or advance', () => {
		const fields = gradeableFields([
			{ key: 'what', text: 'A clock', notApplicable: false },
			{ key: 'when', text: '1864', notApplicable: false }
		]);

		expect(leaveAction(fields, {})).toBe('advance');
		expect(leaveAction(fields, { what: 'learned' })).toBe('confirm');
		expect(leaveAction(fields, { what: 'learned', when: 'unlearned' })).toBe('write');
	});

	it('accepts exactly the card fields and nothing else', () => {
		const fields = gradeableFields([
			{ key: 'what', text: 'A clock', notApplicable: false },
			{ key: 'when', text: '1864', notApplicable: false }
		]);

		expect(verdictsMatchCard(fields, { what: 'learned', when: 'unlearned' })).toBe(true);
		expect(verdictsMatchCard(fields, { what: 'learned' })).toBe(false);
		expect(verdictsMatchCard(fields, { what: 'learned', when: 'learned', why: 'learned' })).toBe(
			false
		);
		expect(verdictsMatchCard(fields, { what: 'learned', when: 'maybe' } as never)).toBe(false);
	});
});
