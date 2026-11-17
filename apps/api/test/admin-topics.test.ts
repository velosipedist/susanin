import { describe, expect, it } from 'vitest';
import {
	FIELD_KEYS,
	type AdminDashboardResponse,
	type AdminSectionDraft,
	type AdminTopicCreateResponse,
	type AdminTopicDeleteConflict,
	type HomeResponse,
	type Run,
	type SectionRun
} from '@susanin/shared';
import { fieldStates } from '../src/db/schema';
import {
	cookieForLearner,
	createTestApi,
	getHome,
	onboardLearner,
	signIn,
	type TestApi
} from './helpers';

const ADMIN_TELEGRAM_ID = 8401;
const LEARNER_TELEGRAM_ID = 8402;

function createAdminApi(): TestApi {
	return createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] });
}

async function adminCookie(api: TestApi): Promise<string> {
	await onboardLearner(api, {
		telegramId: ADMIN_TELEGRAM_ID,
		firstName: 'Niko',
		group: 'A'
	});
	const { cookie } = await signIn(api, { telegramId: ADMIN_TELEGRAM_ID, firstName: 'Niko' });
	return cookie;
}

async function draftFor(api: TestApi, cookie: string, section = 1): Promise<AdminSectionDraft> {
	const response = await api.app.request(`/api/admin/sections/${section}`, {
		headers: { cookie }
	});
	expect(response.status).toBe(200);
	return (await response.json()) as AdminSectionDraft;
}

async function addTopic(api: TestApi, cookie: string, section = 1): Promise<Response> {
	return api.app.request(`/api/admin/sections/${section}/topics`, {
		method: 'POST',
		headers: { cookie }
	});
}

async function reorder(
	api: TestApi,
	cookie: string,
	topicIds: number[],
	section = 1
): Promise<Response> {
	return api.app.request(`/api/admin/sections/${section}/order`, {
		method: 'PUT',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify({ topicIds })
	});
}

async function deleteTopic(
	api: TestApi,
	cookie: string,
	topicId: number,
	resetProgress?: boolean
): Promise<Response> {
	return api.app.request(`/api/admin/topics/${topicId}`, {
		method: 'DELETE',
		headers: {
			cookie,
			...(resetProgress === undefined ? {} : { 'content-type': 'application/json' })
		},
		...(resetProgress === undefined ? {} : { body: JSON.stringify({ resetProgress }) })
	});
}

async function sectionCards(api: TestApi, cookie: string, section = 1): Promise<SectionRun> {
	const response = await api.app.request(`/api/sections/${section}/cards`, {
		headers: { cookie }
	});
	expect(response.status).toBe(200);
	return (await response.json()) as SectionRun;
}

async function gradeAll(api: TestApi, learnerCookie: string, topicId: number): Promise<void> {
	const verdicts = Object.fromEntries(FIELD_KEYS.map((key) => [key, 'learned']));
	const response = await api.app.request(`/api/topics/${topicId}/progress`, {
		method: 'POST',
		headers: { cookie: learnerCookie, 'content-type': 'application/json' },
		body: JSON.stringify({ verdicts })
	});
	expect(response.status).toBe(200);
}

describe('adding a topic', () => {
	it('appends a topic with six empty fields and no side', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);

		const response = await addTopic(api, cookie);
		expect(response.status).toBe(200);
		const created = (await response.json()) as AdminTopicCreateResponse;

		expect(created.topic.side).toBeNull();
		expect(created.topic.name.length).toBeGreaterThan(0);
		expect(created.topic.fields.map((field) => field.key)).toEqual([...FIELD_KEYS]);
		expect(
			created.topic.fields.every((field) => field.text === '' && !field.notApplicable)
		).toBe(true);

		const draft = await draftFor(api, cookie);
		expect(draft.topics).toHaveLength(4);
		expect(draft.topics[3]).toEqual(created.topic);

		api.close();
	});

	it('produces no gradeable card and cannot be graded until fields are authored', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const created = (await (await addTopic(api, cookie)).json()) as AdminTopicCreateResponse;

		const run = await sectionCards(api, cookie);
		expect(run.cards).toHaveLength(3);
		expect(run.cards.some((card) => card.id === created.topic.id)).toBe(false);

		const home = await getHome(api, cookie);
		const homeBody = (await home.json()) as HomeResponse;
		expect(homeBody.sections.find((section) => section.number === 1)?.untouched).toBe(18);

		const verdicts = Object.fromEntries(FIELD_KEYS.map((key) => [key, 'learned']));
		const grade = await api.app.request(`/api/topics/${created.topic.id}/progress`, {
			method: 'POST',
			headers: { cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ verdicts })
		});
		expect(grade.status).toBe(400);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(0);

		api.close();
	});

	it('never prompts about progress, even when neighbours have been graded', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_TELEGRAM_ID, 'A');
		const draft = await draftFor(api, cookie);
		await gradeAll(api, learner, draft.topics[0].id);

		const response = await addTopic(api, cookie);

		expect(response.status).toBe(200);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(6);
		api.close();
	});

	it('refuses an unknown section and a non-admin caller', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_TELEGRAM_ID, 'A');

		const missing = await addTopic(api, cookie, 99);
		const forbidden = await addTopic(api, learner);

		expect(missing.status).toBe(404);
		expect(forbidden.status).toBe(403);
		api.close();
	});
});

describe('reordering topics', () => {
	it('persists the dragged order and cards follow it immediately', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const [first, second, third] = draft.topics;

		const response = await reorder(api, cookie, [third.id, first.id, second.id]);
		expect(response.status).toBe(200);
		const saved = (await response.json()) as { ok: true; draft: AdminSectionDraft };
		expect(saved.draft.topics.map((topic) => topic.id)).toEqual([
			third.id,
			first.id,
			second.id
		]);

		const reread = await draftFor(api, cookie);
		expect(reread.topics.map((topic) => topic.id)).toEqual([third.id, first.id, second.id]);

		const run = await sectionCards(api, cookie);
		expect(run.cards.map((card) => card.id)).toEqual([third.id, first.id, second.id]);

		const groupRun = await api.app.request('/api/runs/learn-new', { headers: { cookie } });
		const groupBody = (await groupRun.json()) as Run;
		expect(
			groupBody.cards
				.filter((card) => card.section.number === 1)
				.map((card) => card.id)
		).toEqual([third.id, first.id, second.id]);

		api.close();
	});

	it('never prompts about progress and keeps every verdict', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_TELEGRAM_ID, 'A');
		const draft = await draftFor(api, cookie);
		const [first, second, third] = draft.topics;
		await gradeAll(api, learner, first.id);

		const response = await reorder(api, cookie, [second.id, third.id, first.id]);

		expect(response.status).toBe(200);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(6);
		api.close();
	});

	it('rejects a list that does not name exactly the stored topics', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const [first, second, third] = draft.topics;
		const otherSection = await draftFor(api, cookie, 2);

		const missing = await reorder(api, cookie, [first.id, second.id]);
		const duplicate = await reorder(api, cookie, [first.id, first.id, second.id]);
		const foreign = await reorder(api, cookie, [first.id, second.id, otherSection.topics[0].id]);

		expect(missing.status).toBe(400);
		expect(duplicate.status).toBe(400);
		expect(foreign.status).toBe(400);
		expect((await draftFor(api, cookie)).topics.map((topic) => topic.id)).toEqual([
			first.id,
			second.id,
			third.id
		]);
		api.close();
	});
});

describe('deleting a topic', () => {
	it('removes a topic without field states after confirmation', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const victim = draft.topics[1];

		const response = await deleteTopic(api, cookie, victim.id);
		expect(response.status).toBe(200);

		const stored = await draftFor(api, cookie);
		expect(stored.topics.map((topic) => topic.id)).toEqual([
			draft.topics[0].id,
			draft.topics[2].id
		]);

		const run = await sectionCards(api, cookie);
		expect(run.cards.some((card) => card.id === victim.id)).toBe(false);

		const dashboard = await api.app.request('/api/admin/dashboard', { headers: { cookie } });
		const body = (await dashboard.json()) as AdminDashboardResponse;
		expect(body.sections.find((section) => section.number === 1)?.topicCount).toBe(2);
		api.close();
	});

	it('refuses a graded topic until Keep or Reset arrives', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_TELEGRAM_ID, 'A');
		const draft = await draftFor(api, cookie);
		const victim = draft.topics[0];
		await gradeAll(api, learner, victim.id);

		const refused = await deleteTopic(api, cookie, victim.id);
		expect(refused.status).toBe(409);
		const conflict = (await refused.json()) as AdminTopicDeleteConflict;
		expect(conflict.error).toBe('progress-affected');
		expect(conflict.affectedTopicIds).toEqual([victim.id]);
		expect(conflict.affectedLearners).toBe(1);
		expect(conflict.topicName).toBe(victim.name);

		expect((await draftFor(api, cookie)).topics).toHaveLength(3);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(6);

		const kept = await deleteTopic(api, cookie, victim.id, false);
		expect(kept.status).toBe(200);
		expect((await draftFor(api, cookie)).topics.some((topic) => topic.id === victim.id)).toBe(
			false
		);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(0);
		api.close();
	});

	it('removes the topic and its states on Reset too', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_TELEGRAM_ID, 'A');
		const draft = await draftFor(api, cookie);
		const victim = draft.topics[0];
		await gradeAll(api, learner, victim.id);

		const response = await deleteTopic(api, cookie, victim.id, true);

		expect(response.status).toBe(200);
		expect((await draftFor(api, cookie)).topics.some((topic) => topic.id === victim.id)).toBe(
			false
		);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(0);
		api.close();
	});

	it('rejects an invalid choice, an unknown topic and a non-admin caller', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_TELEGRAM_ID, 'A');
		const draft = await draftFor(api, cookie);
		const victim = draft.topics[0];

		const invalid = await api.app.request(`/api/admin/topics/${victim.id}`, {
			method: 'DELETE',
			headers: { cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ resetProgress: 'yes' })
		});
		const missing = await deleteTopic(api, cookie, 999_999);
		const forbidden = await deleteTopic(api, learner, victim.id);

		expect(invalid.status).toBe(400);
		expect(missing.status).toBe(404);
		expect(forbidden.status).toBe(403);
		expect((await draftFor(api, cookie)).topics).toHaveLength(3);
		api.close();
	});
});
