import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type {
	AdminDashboardResponse,
	AdminSessionResponse,
	HomeResponse
} from '@susanin/shared';
import type { OidcClient, OidcIdentity } from '../src/auth/oidc';
import { topicFields, topics } from '../src/db/schema';
import {
	createTestApi,
	extractCookie,
	extractSessionCookie,
	getHome,
	onboardLearner,
	signIn
} from './helpers';

const ADMIN_APP_URL = 'http://admin.test/admin/';
const ADMIN_TELEGRAM_ID = 8101;
const LEARNER_TELEGRAM_ID = 8102;

type FakeOidc = OidcClient & {
	exchanges: Array<{ code: string; codeVerifier: string }>;
};

function fakeOidc(result: OidcIdentity | Error): FakeOidc {
	const exchanges: FakeOidc['exchanges'] = [];

	return {
		exchanges,
		authorizationUrl({ state, codeChallenge }) {
			const url = new URL('https://oauth.test/auth');
			url.searchParams.set('client_id', '123456789');
			url.searchParams.set('redirect_uri', 'http://api.test/api/admin/auth/callback');
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'openid profile');
			url.searchParams.set('state', state);
			url.searchParams.set('code_challenge', codeChallenge);
			url.searchParams.set('code_challenge_method', 'S256');
			return url.toString();
		},
		async exchange({ code, codeVerifier }) {
			exchanges.push({ code, codeVerifier });
			if (result instanceof Error) throw result;
			return result;
		}
	};
}

type TestApi = ReturnType<typeof createTestApi>;

async function startAdminLogin(api: TestApi) {
	const response = await api.app.request('/api/admin/auth/login');
	expect(response.status).toBe(302);

	const location = response.headers.get('location');
	expect(location).not.toBeNull();

	return {
		authorizationUrl: new URL(location as string),
		oidcCookie: extractCookie(response, 'susanin_oidc')
	};
}

async function completeAdminLogin(
	api: TestApi,
	input: { authorizationUrl: URL; oidcCookie: string; code?: string; state?: string }
): Promise<Response> {
	const state = input.state ?? input.authorizationUrl.searchParams.get('state') ?? '';
	const code = input.code ?? 'authorization-code';

	return api.app.request(
		`/api/admin/auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
		{ headers: { cookie: input.oidcCookie } }
	);
}

function pkceChallenge(value: string): string {
	return createHash('sha256').update(value).digest('base64url');
}

describe('admin sign-in over HTTP', () => {
	it('exposes no admin data without a session', async () => {
		const api = createTestApi();

		const response = await api.app.request('/api/admin/dashboard');

		expect(response.status).toBe(401);
		api.close();
	});

	it('refuses a signed-in non-admin who calls the admin route directly', async () => {
		const api = createTestApi();
		await onboardLearner(api, {
			telegramId: LEARNER_TELEGRAM_ID,
			firstName: 'Mei',
			group: 'B'
		});
		const { cookie } = await signIn(api, {
			telegramId: LEARNER_TELEGRAM_ID,
			firstName: 'Mei'
		});

		const session = await api.app.request('/api/admin/session', { headers: { cookie } });
		const dashboard = await api.app.request('/api/admin/dashboard', { headers: { cookie } });

		expect(session.status).toBe(200);
		expect(((await session.json()) as AdminSessionResponse).account.isAdmin).toBe(false);
		expect(dashboard.status).toBe(403);
		api.close();
	});

	it('completes the OIDC code flow with PKCE and sets the shared session cookie', async () => {
		const oidc = fakeOidc({ telegramId: ADMIN_TELEGRAM_ID, firstName: 'Niko' });
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] }, { oidc });
		await onboardLearner(api, {
			telegramId: ADMIN_TELEGRAM_ID,
			firstName: 'Niko',
			group: 'A'
		});

		const started = await startAdminLogin(api);
		const challenge = started.authorizationUrl.searchParams.get('code_challenge') ?? '';
		const state = started.authorizationUrl.searchParams.get('state') ?? '';

		expect(started.authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
		expect(started.authorizationUrl.searchParams.get('state')).toBe(state);
		expect(started.authorizationUrl.searchParams.get('redirect_uri')).toBe(
			'http://api.test/api/admin/auth/callback'
		);

		const callback = await completeAdminLogin(api, {
			authorizationUrl: started.authorizationUrl,
			oidcCookie: started.oidcCookie
		});

		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toBe(ADMIN_APP_URL);
		expect(oidc.exchanges).toHaveLength(1);
		expect(pkceChallenge(oidc.exchanges[0].codeVerifier)).toBe(challenge);

		const cookie = extractSessionCookie(callback);
		const session = await api.app.request('/api/admin/session', { headers: { cookie } });
		const body = (await session.json()) as AdminSessionResponse;

		expect(session.status).toBe(200);
		expect(body.account).toEqual({
			telegramId: ADMIN_TELEGRAM_ID,
			displayName: 'Niko',
			group: 'A',
			isAdmin: true
		});
		api.close();
	});

	it('keeps the learner app usable for an admin account', async () => {
		const api = createTestApi(
			{ adminIds: [ADMIN_TELEGRAM_ID] },
			{ oidc: fakeOidc({ telegramId: ADMIN_TELEGRAM_ID, firstName: 'Niko' }) }
		);
		await onboardLearner(api, {
			telegramId: ADMIN_TELEGRAM_ID,
			firstName: 'Niko',
			group: 'C'
		});

		const started = await startAdminLogin(api);
		const callback = await completeAdminLogin(api, {
			authorizationUrl: started.authorizationUrl,
			oidcCookie: started.oidcCookie
		});
		const cookie = extractSessionCookie(callback);

		const home = await getHome(api, cookie);
		const body = (await home.json()) as HomeResponse;

		expect(home.status).toBe(200);
		expect(body.account.group).toBe('C');
		expect(body.sections.map((section) => section.number)).toEqual([11, 12, 13, 14, 15]);
		api.close();
	});

	it('writes no session when the token exchange fails', async () => {
		const api = createTestApi(
			{ adminIds: [ADMIN_TELEGRAM_ID] },
			{ oidc: fakeOidc(new Error('invalid-id-token')) }
		);
		await onboardLearner(api, {
			telegramId: ADMIN_TELEGRAM_ID,
			firstName: 'Niko',
			group: 'A'
		});

		const started = await startAdminLogin(api);
		const callback = await completeAdminLogin(api, {
			authorizationUrl: started.authorizationUrl,
			oidcCookie: started.oidcCookie
		});

		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toBe(`${ADMIN_APP_URL}?error=login-failed`);
		expect(callback.headers.get('set-cookie') ?? '').not.toContain('susanin_session=');
		api.close();
	});

	it('writes no session when the callback state does not match', async () => {
		const oidc = fakeOidc({ telegramId: ADMIN_TELEGRAM_ID, firstName: 'Niko' });
		const api = createTestApi({ adminIds: [ADMIN_TELEGRAM_ID] }, { oidc });
		await onboardLearner(api, {
			telegramId: ADMIN_TELEGRAM_ID,
			firstName: 'Niko',
			group: 'A'
		});

		const started = await startAdminLogin(api);
		const callback = await completeAdminLogin(api, {
			authorizationUrl: started.authorizationUrl,
			oidcCookie: started.oidcCookie,
			state: 'not-the-state'
		});

		expect(callback.headers.get('location')).toBe(`${ADMIN_APP_URL}?error=login-failed`);
		expect(callback.headers.get('set-cookie') ?? '').not.toContain('susanin_session=');
		expect(oidc.exchanges).toHaveLength(0);
		api.close();
	});

	it('sends an unknown Telegram account back without a session', async () => {
		const api = createTestApi(
			{ adminIds: [ADMIN_TELEGRAM_ID] },
			{ oidc: fakeOidc({ telegramId: 999999, firstName: 'Stranger' }) }
		);

		const started = await startAdminLogin(api);
		const callback = await completeAdminLogin(api, {
			authorizationUrl: started.authorizationUrl,
			oidcCookie: started.oidcCookie
		});

		expect(callback.headers.get('location')).toBe(`${ADMIN_APP_URL}?error=not-invited`);
		expect(callback.headers.get('set-cookie') ?? '').not.toContain('susanin_session=');
		api.close();
	});

	it('reports login as unavailable when OIDC is not configured', async () => {
		const api = createTestApi();

		const response = await api.app.request('/api/admin/auth/login');

		expect(response.status).toBe(503);
		api.close();
	});
});

describe('admin dashboard over HTTP', () => {
	async function dashboardFor(api: TestApi): Promise<AdminDashboardResponse> {
		const started = await startAdminLogin(api);
		const callback = await completeAdminLogin(api, {
			authorizationUrl: started.authorizationUrl,
			oidcCookie: started.oidcCookie
		});
		const cookie = extractSessionCookie(callback);

		const response = await api.app.request('/api/admin/dashboard', { headers: { cookie } });
		expect(response.status).toBe(200);
		return (await response.json()) as AdminDashboardResponse;
	}

	it('lists all 25 sections in number order with counts and status', async () => {
		const api = createTestApi(
			{ adminIds: [ADMIN_TELEGRAM_ID] },
			{ oidc: fakeOidc({ telegramId: ADMIN_TELEGRAM_ID, firstName: 'Niko' }) }
		);
		await onboardLearner(api, {
			telegramId: ADMIN_TELEGRAM_ID,
			firstName: 'Niko',
			group: 'A'
		});

		const dashboard = await dashboardFor(api);

		expect(dashboard.totalSections).toBe(25);
		expect(dashboard.sections).toHaveLength(25);
		expect(dashboard.sections.map((section) => section.number)).toEqual(
			Array.from({ length: 25 }, (_, index) => index + 1)
		);
		expect(dashboard.sections[0]).toEqual({
			number: 1,
			name: 'Victoria Harbour',
			topicCount: 3,
			authoredFields: 18,
			notApplicableFields: 0,
			emptyFields: 0,
			status: 'complete'
		});
		api.close();
	});

	it('separates authored, not-applicable and empty fields and marks a section with no content', async () => {
		const api = createTestApi(
			{ adminIds: [ADMIN_TELEGRAM_ID] },
			{ oidc: fakeOidc({ telegramId: ADMIN_TELEGRAM_ID, firstName: 'Niko' }) }
		);
		await onboardLearner(api, {
			telegramId: ADMIN_TELEGRAM_ID,
			firstName: 'Niko',
			group: 'A'
		});

		const secondSectionTopics = api.db
			.select()
			.from(topics)
			.where(eq(topics.sectionNumber, 2))
			.all();
		const thirdSectionTopics = api.db
			.select()
			.from(topics)
			.where(eq(topics.sectionNumber, 3))
			.all();

		api.db
			.update(topicFields)
			.set({ notApplicable: true })
			.where(
				and(eq(topicFields.topicId, secondSectionTopics[0].id), eq(topicFields.key, 'what'))
			)
			.run();
		api.db
			.update(topicFields)
			.set({ text: '' })
			.where(
				and(eq(topicFields.topicId, secondSectionTopics[0].id), eq(topicFields.key, 'when'))
			)
			.run();
		api.db
			.update(topicFields)
			.set({ text: '' })
			.where(
				inArray(
					topicFields.topicId,
					thirdSectionTopics.map((topic) => topic.id)
				)
			)
			.run();

		const dashboard = await dashboardFor(api);
		const second = dashboard.sections.find((section) => section.number === 2);
		const third = dashboard.sections.find((section) => section.number === 3);

		expect(second).toEqual({
			number: 2,
			name: 'Star Ferry',
			topicCount: 3,
			authoredFields: 16,
			notApplicableFields: 1,
			emptyFields: 1,
			status: 'partial'
		});
		expect(third).toEqual({
			number: 3,
			name: "Queen's Pier",
			topicCount: 3,
			authoredFields: 0,
			notApplicableFields: 0,
			emptyFields: 18,
			status: 'empty'
		});
		api.close();
	});
});
