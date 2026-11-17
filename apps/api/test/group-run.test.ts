import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
	buildRun,
	selectedSectionNumbers,
	stepRun,
	type Run,
	type RunSectionInput
} from '@susanin/shared';
import { accounts, topics } from '../src/db/schema';
import { writeTopicFieldStates } from '../src/store/field-states';
import { createTestApi, onboardLearner, signIn, type TestApi } from './helpers';

async function cookieFor(api: TestApi, telegramId: number): Promise<string> {
	await onboardLearner(api, { telegramId, firstName: 'Mei', group: 'B' });
	const { cookie } = await signIn(api, { telegramId, firstName: 'Mei' });
	return cookie;
}

async function runFor(
	api: TestApi,
	cookie: string,
	kind: 'learn-new' | 'repeat-gaps'
): Promise<Run> {
	const response = await api.app.request(`/api/runs/${kind}`, { headers: { cookie } });
	expect(response.status).toBe(200);
	return (await response.json()) as Run;
}

function topicIn(api: TestApi, sectionNumber: number, position: number) {
	const topic = api.db
		.select()
		.from(topics)
		.where(eq(topics.sectionNumber, sectionNumber))
		.all()
		.find((candidate) => candidate.position === position);
	expect(topic).toBeDefined();
	return topic!;
}

describe('group runs over HTTP', () => {
	it('walks every group section in ascending order, continuing across boundaries', async () => {
		const api = createTestApi();
		const cookie = await cookieFor(api, 8101);

		const run = await runFor(api, cookie, 'learn-new');

		expect(run.kind).toBe('learn-new');
		expect(run.cards.map((card) => card.section.number)).toEqual([
			6, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10
		]);
		expect(run.cards[0].name).toBe('Noonday Gun · Placeholder 1');
		expect(run.cards[0].section).toEqual({ number: 6, name: 'Noonday Gun' });
		expect(run.cards[3].section).toEqual({ number: 7, name: 'Victoria Park' });
		expect(run.cards[3].topicCount).toBe(3);
		expect(run.cards.some((card) => card.section.number === 1)).toBe(false);
		api.close();
	});

	it('selects only sections with an unlearned field and walks them whole', async () => {
		const api = createTestApi();
		const cookie = await cookieFor(api, 8102);
		const accountId = api.db.select({ id: accounts.id }).from(accounts).get()!.id;

		writeTopicFieldStates(api.db, {
			accountId,
			topicId: topicIn(api, 7, 1).id,
			gradedAt: api.config.now(),
			states: { what: 'unlearned' }
		});
		writeTopicFieldStates(api.db, {
			accountId,
			topicId: topicIn(api, 9, 3).id,
			gradedAt: api.config.now(),
			states: { when: 'unlearned' }
		});
		// A section with only learned fields makes no gap.
		writeTopicFieldStates(api.db, {
			accountId,
			topicId: topicIn(api, 8, 1).id,
			gradedAt: api.config.now(),
			states: { what: 'learned' }
		});
		// A section outside the learner's group is never part of Repeat.
		writeTopicFieldStates(api.db, {
			accountId,
			topicId: topicIn(api, 1, 1).id,
			gradedAt: api.config.now(),
			states: { what: 'unlearned' }
		});

		const run = await runFor(api, cookie, 'repeat-gaps');

		expect(run.kind).toBe('repeat-gaps');
		expect(run.cards.map((card) => card.section.number)).toEqual([7, 7, 7, 9, 9, 9]);
		api.close();
	});

	it('returns an empty run when nothing has an unlearned field', async () => {
		const api = createTestApi();
		const cookie = await cookieFor(api, 8103);

		const run = await runFor(api, cookie, 'repeat-gaps');

		expect(run).toEqual({ kind: 'repeat-gaps', cards: [] });
		api.close();
	});

	it('rejects readers without a session and unknown run kinds', async () => {
		const api = createTestApi();

		const anonymous = await api.app.request('/api/runs/learn-new');
		expect(anonymous.status).toBe(401);

		const cookie = await cookieFor(api, 8104);
		const unknown = await api.app.request('/api/runs/single-section', { headers: { cookie } });
		expect(unknown.status).toBe(404);
		api.close();
	});
});

describe('run construction rules', () => {
	const section = (number: number, name: string): RunSectionInput => ({
		section: { number, name },
		topics: [
			{
				id: number * 10,
				position: 1,
				name: `${name} topic`,
				side: null,
				fields: [{ key: 'what', text: 'A fact', notApplicable: false }]
			}
		]
	});

	it('orders selected sections by number and flattens their cards', () => {
		const run = buildRun('learn-new', [section(9, 'Nine'), section(6, 'Six')]);

		expect(run.cards.map((card) => card.section.number)).toEqual([6, 9]);
		expect(run.cards[0].section.name).toBe('Six');
		expect(run.cards[0].topicCount).toBe(1);
	});

	it('selects all sections for Learn new and only gap sections for Repeat', () => {
		const sections = [
			{ number: 9, unlearned: 0 },
			{ number: 6, unlearned: 2 },
			{ number: 7, unlearned: 0 },
			{ number: 8, unlearned: 1 }
		];

		expect(selectedSectionNumbers('learn-new', sections)).toEqual([6, 7, 8, 9]);
		expect(selectedSectionNumbers('repeat-gaps', sections)).toEqual([6, 8]);
	});

	it('steps across section boundaries and reports exhaustion', () => {
		expect(stepRun(3, 0, 'next')).toBe(1);
		expect(stepRun(3, 1, 'back')).toBe(0);
		expect(stepRun(3, 0, 'back')).toBe(0);
		expect(stepRun(3, 2, 'next')).toBeNull();
	});
});
