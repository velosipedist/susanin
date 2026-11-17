import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Group, HomeResponse } from '@susanin/shared';
import { accounts, topics, topicFields } from '../src/db/schema';
import { writeTopicFieldStates } from '../src/store/field-states';
import { createTestApi, getHome, onboardLearner, signIn } from './helpers';

async function homeFor(
	api: ReturnType<typeof createTestApi>,
	telegramId: number,
	group: Group
): Promise<HomeResponse> {
	await onboardLearner(api, { telegramId, firstName: 'Mei', group });
	const { cookie } = await signIn(api, { telegramId, firstName: 'Mei' });
	const response = await getHome(api, cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as HomeResponse;
}

describe('home over HTTP', () => {
	it('reads the account and its group sections from the database', async () => {
		const api = createTestApi();

		const home = await homeFor(api, 7001, 'B');

		expect(home.account).toEqual({ firstName: 'Mei', group: 'B' });
		expect(home.totalSections).toBe(25);
		expect(home.sections.map((section) => section.number)).toEqual([6, 7, 8, 9, 10]);
		expect(home.sections.every((section) => section.name.length > 0)).toBe(true);
		api.close();
	});

	it('changes the five sections when the group changes', async () => {
		const api = createTestApi();
		await onboardLearner(api, { telegramId: 7002, firstName: 'Mei', group: 'D' });
		const { cookie } = await signIn(api, { telegramId: 7002, firstName: 'Mei' });

		const response = await getHome(api, cookie);
		const home = (await response.json()) as HomeResponse;

		expect(home.account.group).toBe('D');
		expect(home.sections.map((section) => section.number)).toEqual([16, 17, 18, 19, 20]);
		api.close();
	});

	it('counts learned, unlearned and untouched authored fields per section', async () => {
		const api = createTestApi();
		await onboardLearner(api, { telegramId: 7003, firstName: 'Mei', group: 'B' });
		const { cookie } = await signIn(api, { telegramId: 7003, firstName: 'Mei' });

		const first = api.db
			.select()
			.from(topics)
			.where(eq(topics.sectionNumber, 6))
			.orderBy(topics.position)
			.get();
		expect(first).toBeDefined();

		const account = api.db.select({ id: accounts.id }).from(accounts).get();

		writeTopicFieldStates(api.db, {
			accountId: account?.id as number,
			topicId: first!.id,
			gradedAt: api.config.now(),
			states: { what: 'learned', when: 'learned', where: 'learned', why: 'unlearned', who: 'unlearned' }
		});

		const response = await getHome(api, cookie);
		const home = (await response.json()) as HomeResponse;
		const section6 = home.sections.find((section) => section.number === 6);

		expect(section6).toEqual({
			number: 6,
			name: 'Noonday Gun',
			learned: 3,
			unlearned: 2,
			untouched: 13
		});
		api.close();
	});

	it('excludes marked-not-applicable and empty fields from every count', async () => {
		const api = createTestApi();
		await onboardLearner(api, { telegramId: 7004, firstName: 'Mei', group: 'B' });
		const { cookie } = await signIn(api, { telegramId: 7004, firstName: 'Mei' });

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

		const response = await getHome(api, cookie);
		const home = (await response.json()) as HomeResponse;
		const section6 = home.sections.find((section) => section.number === 6);

		expect(section6?.untouched).toBe(16);
		api.close();
	});
});
