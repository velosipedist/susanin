import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { AdminCohortResponse, AdminPeopleResponse, HomeResponse } from '@susanin/shared';
import { accounts, fieldStates, groupSections, topics } from '../src/db/schema';
import { seedContent } from '../src/db/seed';
import { writeTopicFieldStates } from '../src/store/field-states';
import { createTestApi, getHome, onboardLearner, signIn } from './helpers';

const ADMIN_TELEGRAM_ID = 9001;
const LEARNER_TELEGRAM_ID = 9002;

type TestApi = ReturnType<typeof createTestApi>;

function put(
	api: TestApi,
	cookie: string,
	path: string,
	body: unknown
): Response | Promise<Response> {
	return api.app.request(path, {
		method: 'PUT',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

async function adminSession(api: TestApi): Promise<string> {
	await onboardLearner(api, {
		telegramId: ADMIN_TELEGRAM_ID,
		firstName: 'Niko',
		group: 'A'
	});
	const { cookie } = await signIn(api, {
		telegramId: ADMIN_TELEGRAM_ID,
		firstName: 'Niko'
	});
	return cookie;
}

async function learnerSession(
	api: TestApi,
	input: { telegramId?: number; firstName?: string; group: 'A' | 'B' | 'C' | 'D' | 'E' }
): Promise<string> {
	const telegramId = input.telegramId ?? LEARNER_TELEGRAM_ID;
	const firstName = input.firstName ?? 'Mei';

	await onboardLearner(api, { telegramId, firstName, group: input.group });
	const { cookie } = await signIn(api, { telegramId, firstName });
	return cookie;
}

async function readCohort(api: TestApi, cookie: string): Promise<AdminCohortResponse> {
	const response = await api.app.request('/api/admin/cohort', { headers: { cookie } });
	expect(response.status).toBe(200);
	return (await response.json()) as AdminCohortResponse;
}

async function readPeople(api: TestApi, cookie: string): Promise<AdminPeopleResponse> {
	const response = await api.app.request('/api/admin/people', { headers: { cookie } });
	expect(response.status).toBe(200);
	return (await response.json()) as AdminPeopleResponse;
}

async function readHome(api: TestApi, cookie: string): Promise<HomeResponse> {
	const response = await getHome(api, cookie);
	expect(response.status).toBe(200);
	return (await response.json()) as HomeResponse;
}

function topicInSection(api: TestApi, sectionNumber: number) {
	const topic = api.db
		.select()
		.from(topics)
		.where(eq(topics.sectionNumber, sectionNumber))
		.orderBy(topics.position)
		.get();
	expect(topic).toBeDefined();
	return topic!;
}

describe('admin cohort map over HTTP', () => {
	it('lists every section with its group and a count for each group', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);

		const cohort = await readCohort(api, cookie);

		expect(cohort.sections.map((section) => section.number)).toEqual(
			Array.from({ length: 25 }, (_, index) => index + 1)
		);
		expect(cohort.sections.find((section) => section.number === 1)?.group).toBe('A');
		expect(cohort.sections.find((section) => section.number === 6)?.group).toBe('B');
		expect(cohort.sections.find((section) => section.number === 25)?.group).toBe('E');
		expect(cohort.groups).toEqual([
			{ group: 'A', sectionCount: 5 },
			{ group: 'B', sectionCount: 5 },
			{ group: 'C', sectionCount: 5 },
			{ group: 'D', sectionCount: 5 },
			{ group: 'E', sectionCount: 5 }
		]);
		api.close();
	});

	it('moves a section to one group without ever having two, and shows the off-five count', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);
		const learner = await learnerSession(api, { telegramId: 9003, group: 'C' });

		const moved = await put(api, cookie, '/api/admin/sections/1/group', { group: 'C' });
		expect(moved.status).toBe(200);
		const cohort = (await moved.json()) as AdminCohortResponse;

		expect(cohort.sections.find((section) => section.number === 1)?.group).toBe('C');
		expect(cohort.groups.find((group) => group.group === 'A')?.sectionCount).toBe(4);
		expect(cohort.groups.find((group) => group.group === 'C')?.sectionCount).toBe(6);

		const stored = api.db
			.select()
			.from(groupSections)
			.where(eq(groupSections.sectionNumber, 1))
			.all();
		expect(stored).toEqual([{ groupName: 'C', sectionNumber: 1 }]);

		expect(() =>
			api.db.insert(groupSections).values({ groupName: 'D', sectionNumber: 1 }).run()
		).toThrow();

		// The learner's scope follows the map immediately.
		const home = await readHome(api, learner);
		expect(home.sections.map((section) => section.number)).toEqual([1, 11, 12, 13, 14, 15]);

		// A restart reseeds content but must not restore the demo mapping.
		seedContent(api.db);
		expect((await readCohort(api, cookie)).sections[0].group).toBe('C');

		const cleared = await put(api, cookie, '/api/admin/sections/1/group', { group: null });
		expect(cleared.status).toBe(200);
		const clearedCohort = (await cleared.json()) as AdminCohortResponse;

		expect(clearedCohort.sections.find((section) => section.number === 1)?.group).toBeNull();
		expect(clearedCohort.groups.find((group) => group.group === 'A')?.sectionCount).toBe(4);
		expect(clearedCohort.groups.find((group) => group.group === 'C')?.sectionCount).toBe(5);
		expect((await readHome(api, learner)).sections.map((section) => section.number)).toEqual([
			11, 12, 13, 14, 15
		]);
		api.close();
	});

	it('rejects an invalid group and an unknown section', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);

		const invalid = await put(api, cookie, '/api/admin/sections/1/group', { group: 'F' });
		const missing = await put(api, cookie, '/api/admin/sections/99/group', { group: 'A' });

		expect(invalid.status).toBe(400);
		expect(missing.status).toBe(404);
		api.close();
	});
});

describe('admin people list over HTTP', () => {
	it('shows every account with its group and the number of sections touched', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);
		await learnerSession(api, { telegramId: 9004, firstName: 'Mei', group: 'B' });

		const learner = api.db
			.select({ id: accounts.id })
			.from(accounts)
			.where(eq(accounts.telegramId, 9004))
			.get();

		writeTopicFieldStates(api.db, {
			accountId: learner!.id,
			topicId: topicInSection(api, 6).id,
			gradedAt: api.config.now(),
			states: { what: 'learned' }
		});
		writeTopicFieldStates(api.db, {
			accountId: learner!.id,
			topicId: topicInSection(api, 7).id,
			gradedAt: api.config.now(),
			states: { what: 'learned', when: 'unlearned' }
		});

		let people = await readPeople(api, cookie);
		const mei = people.people.find((person) => person.telegramId === 9004);

		expect(mei).toEqual({
			telegramId: 9004,
			displayName: 'Mei',
			group: 'B',
			touchedSections: 2,
			isAdmin: false
		});
		expect(people.people.find((person) => person.telegramId === ADMIN_TELEGRAM_ID)).toMatchObject({
			group: 'A',
			touchedSections: 0,
			isAdmin: true
		});

		// One more verdict inside an already touched section does not add a section.
		writeTopicFieldStates(api.db, {
			accountId: learner!.id,
			topicId: topicInSection(api, 6).id,
			gradedAt: api.config.now(),
			states: { what: 'learned', when: 'learned', where: 'learned', why: 'learned', who: 'learned', how: 'learned' }
		});

		people = await readPeople(api, cookie);
		expect(people.people.find((person) => person.telegramId === 9004)?.touchedSections).toBe(2);
		api.close();
	});

	it('moves a learner to another group without touching any field state', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);
		const learner = await learnerSession(api, { telegramId: 9005, group: 'B' });

		const account = api.db
			.select({ id: accounts.id })
			.from(accounts)
			.where(eq(accounts.telegramId, 9005))
			.get();

		writeTopicFieldStates(api.db, {
			accountId: account!.id,
			topicId: topicInSection(api, 6).id,
			gradedAt: api.config.now(),
			states: { what: 'learned', when: 'unlearned' }
		});

		const before = api.db
			.select({ count: sql<number>`count(*)` })
			.from(fieldStates)
			.get();

		const moved = await put(api, cookie, '/api/admin/accounts/9005/group', { group: 'D' });
		expect(moved.status).toBe(200);
		const people = (await moved.json()) as AdminPeopleResponse;

		expect(people.people.find((person) => person.telegramId === 9005)).toMatchObject({
			group: 'D',
			touchedSections: 1
		});

		const after = api.db
			.select({ count: sql<number>`count(*)` })
			.from(fieldStates)
			.get();
		expect(after?.count).toBe(before?.count);

		const home = await readHome(api, learner);
		expect(home.account.group).toBe('D');
		expect(home.sections.map((section) => section.number)).toEqual([16, 17, 18, 19, 20]);

		const missing = await put(api, cookie, '/api/admin/accounts/123456/group', { group: 'A' });
		const invalid = await put(api, cookie, '/api/admin/accounts/9005/group', { group: 'F' });
		expect(missing.status).toBe(404);
		expect(invalid.status).toBe(400);
		api.close();
	});
});

describe('admin rights over HTTP', () => {
	it('promotes and demotes an account, enforcing the change on the next request', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);
		const learner = await learnerSession(api, { telegramId: 9006, group: 'B' });

		const refused = await api.app.request('/api/admin/people', { headers: { cookie: learner } });
		expect(refused.status).toBe(403);

		const promoted = await put(api, cookie, '/api/admin/accounts/9006/admin', { isAdmin: true });
		expect(promoted.status).toBe(200);
		expect(
			((await promoted.json()) as AdminPeopleResponse).people.find(
				(person) => person.telegramId === 9006
			)?.isAdmin
		).toBe(true);

		// The session cookie was issued before the promotion; the next request sees it.
		const allowed = await api.app.request('/api/admin/people', { headers: { cookie: learner } });
		expect(allowed.status).toBe(200);

		// A fresh Mini App sign-in must not undo the in-app promotion.
		const fresh = await signIn(api, { telegramId: 9006, firstName: 'Mei' });
		const stillAllowed = await api.app.request('/api/admin/people', {
			headers: { cookie: fresh.cookie }
		});
		expect(stillAllowed.status).toBe(200);

		const demoted = await put(api, cookie, '/api/admin/accounts/9006/admin', { isAdmin: false });
		expect(demoted.status).toBe(200);
		const refusedAgain = await api.app.request('/api/admin/people', {
			headers: { cookie: learner }
		});
		expect(refusedAgain.status).toBe(403);
		api.close();
	});

	it('keeps ADMIN_IDS as an admin grant even after an in-app revoke', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		const cookie = await adminSession(api);

		const revoked = await put(api, cookie, `/api/admin/accounts/${ADMIN_TELEGRAM_ID}/admin`, {
			isAdmin: false
		});
		expect(revoked.status).toBe(200);

		const people = await api.app.request('/api/admin/people', { headers: { cookie } });
		expect(people.status).toBe(200);
		expect(
			((await people.json()) as AdminPeopleResponse).people.find(
				(person) => person.telegramId === ADMIN_TELEGRAM_ID
			)?.isAdmin
		).toBe(true);

		const session = await api.app.request('/api/admin/session', { headers: { cookie } });
		expect(((await session.json()) as { account: { isAdmin: boolean } }).account.isAdmin).toBe(
			true
		);
		api.close();
	});

	it('refuses a non-admin every cohort and people route', async () => {
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
		await adminSession(api);
		const learner = await learnerSession(api, { telegramId: 9007, group: 'B' });

		const attempts = await Promise.all([
			api.app.request('/api/admin/cohort', { headers: { cookie: learner } }),
			api.app.request('/api/admin/people', { headers: { cookie: learner } }),
			put(api, learner, '/api/admin/sections/1/group', { group: 'B' }),
			put(api, learner, '/api/admin/accounts/9007/group', { group: 'C' }),
			put(api, learner, '/api/admin/accounts/9007/admin', { isAdmin: true })
		]);

		expect(attempts.map((response) => response.status)).toEqual([403, 403, 403, 403, 403]);
		api.close();
	});
});
