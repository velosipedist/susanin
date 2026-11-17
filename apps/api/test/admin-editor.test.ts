import { describe, expect, it } from 'vitest';
import {
	FIELD_KEYS,
	type AdminProgressConflict,
	type AdminSectionDraft,
	type AdminSectionReview,
	type AdminSectionSaveResponse,
	type HomeResponse,
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

const ADMIN_TELEGRAM_ID = 8301;
const LEARNER_ONE = 8302;
const LEARNER_TWO = 8303;

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

function bodyFor(draft: AdminSectionDraft) {
	return { name: draft.section.name, topics: draft.topics };
}

async function review(
	api: TestApi,
	cookie: string,
	section: number,
	draft: AdminSectionDraft
): Promise<Response> {
	return api.app.request(`/api/admin/sections/${section}/review`, {
		method: 'POST',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify(bodyFor(draft))
	});
}

async function save(
	api: TestApi,
	cookie: string,
	section: number,
	draft: AdminSectionDraft,
	resetProgress?: boolean
): Promise<Response> {
	return api.app.request(`/api/admin/sections/${section}`, {
		method: 'PUT',
		headers: { cookie, 'content-type': 'application/json' },
		body: JSON.stringify({
			...bodyFor(draft),
			...(resetProgress === undefined ? {} : { resetProgress })
		})
	});
}

/** Grades every field of one topic as a complete card, through the learner route. */
async function gradeTopic(api: TestApi, learnerCookie: string, topicId: number): Promise<void> {
	const verdicts = Object.fromEntries(FIELD_KEYS.map((key) => [key, 'learned']));
	const response = await api.app.request(`/api/topics/${topicId}/progress`, {
		method: 'POST',
		headers: { cookie: learnerCookie, 'content-type': 'application/json' },
		body: JSON.stringify({ verdicts })
	});
	expect(response.status).toBe(200);
}

describe('loading a section into the editor', () => {
	it('returns the section name with ordered topics and exactly six fields each', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);

		const draft = await draftFor(api, cookie);

		expect(draft.section).toEqual({ number: 1, name: 'Victoria Harbour' });
		expect(draft.topics).toHaveLength(3);
		expect(draft.topics.map((topic) => topic.name)).toEqual([
			'Victoria Harbour · Placeholder 1',
			'Victoria Harbour · Placeholder 2',
			'Victoria Harbour · Placeholder 3'
		]);

		for (const topic of draft.topics) {
			expect(topic.fields).toHaveLength(6);
			expect(topic.fields.map((field) => field.key)).toEqual([...FIELD_KEYS]);
		}

		api.close();
	});

	it('refuses a section that does not exist and a non-admin caller', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learnerCookie = await cookieForLearner(api, LEARNER_ONE, 'A');

		const missing = await api.app.request('/api/admin/sections/99', { headers: { cookie } });
		const forbidden = await api.app.request('/api/admin/sections/1', {
			headers: { cookie: learnerCookie }
		});

		expect(missing.status).toBe(404);
		expect(forbidden.status).toBe(403);
		api.close();
	});
});

describe('the content diff before a save', () => {
	it('reports changed names, field texts and not-applicable flags, but not side or reorder', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const [first, second, third] = draft.topics;

		const previousWhat = first.fields[0].text;
		const previousSecondName = second.name;
		first.fields[0].text = `${previousWhat} corrected`;
		second.name = 'Renamed topic';
		third.fields[1].notApplicable = true;
		first.side = 'right';
		draft.section.name = 'Renamed section';
		draft.topics = [third, second, first];

		const response = await review(api, cookie, 1, draft);
		expect(response.status).toBe(200);
		const result = (await response.json()) as AdminSectionReview;

		expect(result.section).toEqual({
			number: 1,
			previousName: 'Victoria Harbour',
			name: 'Renamed section'
		});
		expect(result.reordered).toBe(true);
		expect(result.sideChanges).toEqual([
			{ id: first.id, previousSide: 'left', side: 'right' }
		]);
		expect(result.affectedTopicIds).toEqual([]);
		expect(result.affectedLearners).toBe(0);

		const changed = new Map(result.topics.map((topic) => [topic.id, topic]));
		expect(changed.size).toBe(3);
		expect(changed.get(first.id)?.fields).toEqual([
			{
				key: 'what',
				previousText: previousWhat,
				text: `${previousWhat} corrected`,
				previousNotApplicable: false,
				notApplicable: false
			}
		]);
		expect(changed.get(second.id)?.previousName).toBe(previousSecondName);
		expect(changed.get(second.id)?.name).toBe('Renamed topic');
		expect(changed.get(second.id)?.fields).toEqual([]);
		expect(changed.get(third.id)?.fields).toEqual([
			{
				key: 'when',
				previousText: third.fields[1].text,
				text: third.fields[1].text,
				previousNotApplicable: false,
				notApplicable: true
			}
		]);

		api.close();
	});

	it('treats a section rename, a side change and a reorder as non-content changes', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);

		draft.section.name = 'Only the section name moved';
		draft.topics[0].side = null;
		draft.topics = [...draft.topics].reverse();

		const response = await review(api, cookie, 1, draft);
		const result = (await response.json()) as AdminSectionReview;

		expect(response.status).toBe(200);
		expect(result.topics).toEqual([]);
		expect(result.reordered).toBe(true);
		expect(result.sideChanges).toHaveLength(1);
		expect(result.affectedLearners).toBe(0);

		api.close();
	});

	it('writes nothing while the review is being shown', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		draft.topics[0].fields[0].text = 'Only in the draft';

		const preview = await review(api, cookie, 1, draft);
		expect(preview.status).toBe(200);

		const stored = await draftFor(api, cookie);
		expect(stored.topics[0].fields[0].text).not.toBe('Only in the draft');
		api.close();
	});
});

describe('saving a section draft', () => {
	it('writes names, field texts, sides and route order only on the save request', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const [first, second, third] = draft.topics;

		draft.section.name = 'Harbour front';
		first.name = 'Edited first';
		first.fields[0].text = 'Corrected what';
		first.side = 'right';
		draft.topics = [third, first, second];

		const response = await save(api, cookie, 1, draft);
		expect(response.status).toBe(200);
		const saved = (await response.json()) as AdminSectionSaveResponse;

		expect(saved.ok).toBe(true);
		expect(saved.draft.section.name).toBe('Harbour front');
		expect(saved.draft.topics.map((topic) => topic.id)).toEqual([
			third.id,
			first.id,
			second.id
		]);
		expect(saved.draft.topics.map((topic) => topic.name)).toEqual([
			third.name,
			'Edited first',
			second.name
		]);
		expect(saved.draft.topics[1].side).toBe('right');
		expect(saved.draft.topics[1].fields[0].text).toBe('Corrected what');

		const reread = await draftFor(api, cookie);
		expect(reread.section.name).toBe('Harbour front');
		expect(reread.topics.map((topic) => topic.id)).toEqual([third.id, first.id, second.id]);

		api.close();
	});

	it('hides a field marked not applicable from cards and from progress counts', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const first = draft.topics[0];

		draft.topics[0].fields[0].notApplicable = true;

		const response = await save(api, cookie, 1, draft);
		expect(response.status).toBe(200);

		const cards = await api.app.request('/api/sections/1/cards', { headers: { cookie } });
		const run = (await cards.json()) as SectionRun;
		const firstCard = run.cards.find((card) => card.id === first.id);
		expect(firstCard?.fields.map((field) => field.key)).toEqual([
			'when',
			'where',
			'why',
			'who',
			'how'
		]);

		const home = await getHome(api, cookie);
		const body = (await home.json()) as HomeResponse;
		const sectionOne = body.sections.find((section) => section.number === 1);
		expect(sectionOne?.untouched).toBe(17);

		api.close();
	});

	it('rejects a draft without six distinct fields or with an invalid side', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const original = await draftFor(api, cookie);

		const fiveFields = structuredClone(original);
		fiveFields.topics[0].fields.pop();
		const missingField = await save(api, cookie, 1, fiveFields);

		const duplicateField = structuredClone(original);
		duplicateField.topics[0].fields[1].key = duplicateField.topics[0].fields[0].key;
		const duplicate = await save(api, cookie, 1, duplicateField);

		const invalidSide = structuredClone(original);
		(invalidSide.topics[0] as unknown as { side: string }).side = 'middle';
		const badSide = await save(api, cookie, 1, invalidSide);

		const missingTopic = structuredClone(original);
		missingTopic.topics.pop();
		const absentTopic = await save(api, cookie, 1, missingTopic);

		expect(missingField.status).toBe(400);
		expect(duplicate.status).toBe(400);
		expect(badSide.status).toBe(400);
		expect(absentTopic.status).toBe(400);

		const stored = await draftFor(api, cookie);
		expect(stored).toEqual(original);
		api.close();
	});
});

describe('refusing a save that would invalidate progress', () => {
	it('returns 409 with affected topic ids and learner count, and writes nothing', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const first = draft.topics[0];

		const learnerOne = await cookieForLearner(api, LEARNER_ONE, 'A');
		const learnerTwo = await cookieForLearner(api, LEARNER_TWO, 'A');
		await gradeTopic(api, learnerOne, first.id);
		await gradeTopic(api, learnerTwo, first.id);

		const originalText = first.fields[0].text;
		const originalSecondText = draft.topics[1].fields[0].text;
		draft.topics[0].fields[0].text = `${originalText} corrected`;
		draft.topics[1].fields[0].text = `${originalSecondText} corrected`;

		const preview = await review(api, cookie, 1, draft);
		expect(preview.status).toBe(200);
		const reviewed = (await preview.json()) as AdminSectionReview;
		expect(reviewed.topics).toHaveLength(2);
		expect(reviewed.affectedTopicIds).toEqual([first.id]);
		expect(reviewed.affectedLearners).toBe(2);

		const response = await save(api, cookie, 1, draft);
		expect(response.status).toBe(409);
		const conflict = (await response.json()) as AdminProgressConflict;

		expect(conflict.error).toBe('progress-affected');
		expect(conflict.affectedTopicIds).toEqual([first.id]);
		expect(conflict.affectedLearners).toBe(2);
		expect(conflict.review.topics).toHaveLength(2);
		expect(conflict.review.topics[0].id).toBe(first.id);

		const stored = await draftFor(api, cookie);
		expect(stored.topics[0].fields[0].text).toBe(originalText);
		expect(stored.topics[1].fields[0].text).toBe(originalSecondText);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(12);

		api.close();
	});

	it('writes a change to a topic without any field state', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		const graded = draft.topics[0];
		const untouched = draft.topics[1];

		const learner = await cookieForLearner(api, LEARNER_ONE, 'A');
		await gradeTopic(api, learner, graded.id);

		untouched.fields[2].text = 'A corrected where';

		const response = await save(api, cookie, 1, draft);
		expect(response.status).toBe(200);

		const stored = await draftFor(api, cookie);
		expect(stored.topics[1].fields[2].text).toBe('A corrected where');
		expect(stored.topics[0].fields[0].text).toBe(graded.fields[0].text);
		api.close();
	});
});

describe('choosing Keep or Reset after a refused save', () => {
	async function conflictedDraft(api: TestApi, cookie: string) {
		const draft = await draftFor(api, cookie);
		draft.topics[0].fields[0].text = `${draft.topics[0].fields[0].text} corrected`;
		const response = await save(api, cookie, 1, draft);
		expect(response.status).toBe(409);
		return draft;
	}

	it('writes the change on Keep and leaves every field state untouched', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learnerOne = await cookieForLearner(api, LEARNER_ONE, 'A');
		const learnerTwo = await cookieForLearner(api, LEARNER_TWO, 'A');
		const draft = await draftFor(api, cookie);
		await gradeTopic(api, learnerOne, draft.topics[0].id);
		await gradeTopic(api, learnerTwo, draft.topics[0].id);

		const conflicted = await conflictedDraft(api, cookie);
		const response = await save(api, cookie, 1, conflicted, false);
		expect(response.status).toBe(200);

		const stored = await draftFor(api, cookie);
		expect(stored.topics[0].fields[0].text).toBe(conflicted.topics[0].fields[0].text);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(12);
		api.close();
	});

	it('writes the change on Reset and clears only the affected topics for every learner', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learnerOne = await cookieForLearner(api, LEARNER_ONE, 'A');
		const learnerTwo = await cookieForLearner(api, LEARNER_TWO, 'A');
		const draft = await draftFor(api, cookie);
		const affected = draft.topics[0];
		const unaffected = draft.topics[1];
		await gradeTopic(api, learnerOne, affected.id);
		await gradeTopic(api, learnerOne, unaffected.id);
		await gradeTopic(api, learnerTwo, affected.id);
		await gradeTopic(api, learnerTwo, unaffected.id);
		expect(api.db.select().from(fieldStates).all()).toHaveLength(24);

		const conflicted = await conflictedDraft(api, cookie);
		const response = await save(api, cookie, 1, conflicted, true);
		expect(response.status).toBe(200);

		const stored = await draftFor(api, cookie);
		expect(stored.topics[0].fields[0].text).toBe(conflicted.topics[0].fields[0].text);

		const remaining = api.db.select().from(fieldStates).all();
		expect(remaining).toHaveLength(12);
		expect(remaining.every((state) => state.topicId === unaffected.id)).toBe(true);

		const home = await getHome(api, learnerOne);
		const body = (await home.json()) as HomeResponse;
		const sectionOne = body.sections.find((section) => section.number === 1);
		expect(sectionOne).toMatchObject({ learned: 6, unlearned: 0, untouched: 12 });
		api.close();
	});

	it('never prompts for a reorder, side change or section rename', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const learner = await cookieForLearner(api, LEARNER_ONE, 'A');
		const draft = await draftFor(api, cookie);
		await gradeTopic(api, learner, draft.topics[0].id);

		draft.section.name = 'Renamed while graded';
		draft.topics[0].side = 'right';
		draft.topics = [...draft.topics].reverse();

		const response = await save(api, cookie, 1, draft);
		expect(response.status).toBe(200);

		const stored = await draftFor(api, cookie);
		expect(stored.section.name).toBe('Renamed while graded');
		expect(stored.topics.map((topic) => topic.id)).toEqual(draft.topics.map((topic) => topic.id));
		expect(api.db.select().from(fieldStates).all()).toHaveLength(6);
		api.close();
	});

	it('rejects a reset choice that is not a boolean', async () => {
		const api = createAdminApi();
		const cookie = await adminCookie(api);
		const draft = await draftFor(api, cookie);
		draft.topics[0].fields[0].text = `${draft.topics[0].fields[0].text} corrected`;

		const response = await api.app.request('/api/admin/sections/1', {
			method: 'PUT',
			headers: { cookie, 'content-type': 'application/json' },
			body: JSON.stringify({ ...bodyFor(draft), resetProgress: 'yes' })
		});

		expect(response.status).toBe(400);
		expect((await draftFor(api, cookie)).topics[0].fields[0].text).not.toBe(
			draft.topics[0].fields[0].text
		);
		api.close();
	});
});
