import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { SectionListResponse } from '@susanin/shared';
import { accounts, topicFields, topics } from '../src/db/schema';
import { writeTopicFieldStates } from '../src/store/field-states';
import { cookieForLearner, createTestApi, topicIn, type TestApi } from './helpers';

async function listFor(api: TestApi, cookie: string): Promise<SectionListResponse> {
	const response = await api.app.request('/api/sections', { headers: { cookie } });
	expect(response.status).toBe(200);
	return (await response.json()) as SectionListResponse;
}

describe('all sections list over HTTP', () => {
	it('lists all 25 sections in number order and marks only the group in scope', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8201);

		const list = await listFor(api, cookie);

		expect(list.account).toEqual({ firstName: 'Mei', group: 'B' });
		expect(list.sections).toHaveLength(25);
		expect(list.sections.map((section) => section.number)).toEqual(
			Array.from({ length: 25 }, (_, index) => index + 1)
		);
		expect(list.sections.filter((section) => section.inScope).map((section) => section.number)).toEqual(
			[6, 7, 8, 9, 10]
		);
		expect(list.sections.every((section) => section.name.length > 0)).toBe(true);
		api.close();
	});

	it('counts progress in sections outside the learner group', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8202);
		const accountId = api.db.select({ id: accounts.id }).from(accounts).get()!.id;

		writeTopicFieldStates(api.db, {
			accountId,
			topicId: topicIn(api, 1, 1).id,
			gradedAt: api.config.now(),
			states: { what: 'learned', when: 'unlearned' }
		});

		const list = await listFor(api, cookie);
		const first = list.sections.find((section) => section.number === 1);

		expect(first).toEqual({
			number: 1,
			name: 'Victoria Harbour',
			learned: 1,
			unlearned: 1,
			untouched: 16,
			inScope: false
		});
		api.close();
	});

	it('reports a section with no authored content as all zeroes and unplayable', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8203);

		const topicIds = api.db
			.select({ id: topics.id })
			.from(topics)
			.where(eq(topics.sectionNumber, 25))
			.all()
			.map((topic) => topic.id);

		api.db
			.update(topicFields)
			.set({ text: '', notApplicable: false })
			.where(inArray(topicFields.topicId, topicIds))
			.run();

		const list = await listFor(api, cookie);
		const last = list.sections.find((section) => section.number === 25);

		expect(last).toEqual({
			number: 25,
			name: 'Happy Valley Racecourse',
			learned: 0,
			unlearned: 0,
			untouched: 0,
			inScope: false
		});

		const cards = await api.app.request('/api/sections/25/cards', { headers: { cookie } });
		expect(cards.status).toBe(200);
		expect(((await cards.json()) as { cards: unknown[] }).cards).toEqual([]);
		api.close();
	});

	it('serves a section outside the learner group', async () => {
		const api = createTestApi();
		const cookie = await cookieForLearner(api, 8204);

		const response = await api.app.request('/api/sections/1/cards', { headers: { cookie } });

		expect(response.status).toBe(200);
		const run = (await response.json()) as { section: { number: number }; cards: unknown[] };
		expect(run.section.number).toBe(1);
		expect(run.cards.length).toBeGreaterThan(0);
		api.close();
	});

	it('rejects readers without a session', async () => {
		const api = createTestApi();

		const response = await api.app.request('/api/sections');
		expect(response.status).toBe(401);
		api.close();
	});
});
