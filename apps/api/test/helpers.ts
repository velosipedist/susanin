import { createHmac } from 'node:crypto';
import type { Hono } from 'hono';
import type { Group } from '@susanin/shared';
import { createApp } from '../src/app';
import type { OidcClient } from '../src/auth/oidc';
import { type ApiConfig } from '../src/config';
import { openDatabase, type SusaninDatabase } from '../src/db';
import { seedContent } from '../src/db/seed';

export const BASE_NOW = Date.UTC(2026, 4, 1, 12, 0, 0);

export type TestApi = {
	app: Hono;
	db: SusaninDatabase;
	config: ApiConfig;
	close(): void;
};

export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
	return {
		sessionSecret: 'test-session-secret',
		botToken: '123456:test-bot-token',
		botSecret: 'test-bot-secret',
		inviteCode: 'susanin-test',
		adminIds: [],
		initDataMaxAgeSeconds: 300,
		sessionTtlSeconds: 3600,
		cookieSecure: false,
		devAuth: false,
		devTelegramId: 1,
		devDisplayName: 'Dev',
		databaseFile: ':memory:',
		port: 0,
		adminAppUrl: 'http://admin.test/admin/',
		telegramOidc: null,
		now: () => BASE_NOW,
		...overrides
	};
}

export function createTestApi(
	overrides: Partial<ApiConfig> = {},
	deps: { oidc?: OidcClient | null } = {}
): TestApi {
	const { db, close } = openDatabase(':memory:');
	seedContent(db);
	const config = testConfig(overrides);
	const app = createApp({ db, config, oidc: deps.oidc });
	return { app, db, config, close };
}

export function makeInitData(input: {
	botToken: string;
	user: { id: number; first_name: string; username?: string };
	authDateSeconds: number;
	queryId?: string;
}): string {
	const params = new URLSearchParams({
		query_id: input.queryId ?? 'AAH-test-query',
		user: JSON.stringify(input.user),
		auth_date: String(input.authDateSeconds)
	});

	const dataCheckString = [...params.entries()]
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');

	const secretKey = createHmac('sha256', 'WebAppData').update(input.botToken).digest();
	const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

	params.set('hash', hash);
	return params.toString();
}

export function botHeaders(config: ApiConfig): Record<string, string> {
	return { 'content-type': 'application/json', 'x-bot-secret': config.botSecret };
}

export async function botStart(
	api: TestApi,
	body: { telegramId: number; firstName: string }
): Promise<Response> {
	return api.app.request('/api/bot/start', {
		method: 'POST',
		headers: botHeaders(api.config),
		body: JSON.stringify(body)
	});
}

export async function botInvite(
	api: TestApi,
	body: { telegramId: number; firstName: string; code: string }
): Promise<Response> {
	return api.app.request('/api/bot/invite', {
		method: 'POST',
		headers: botHeaders(api.config),
		body: JSON.stringify(body)
	});
}

export async function botGroup(
	api: TestApi,
	body: { telegramId: number; group: Group }
): Promise<Response> {
	return api.app.request('/api/bot/group', {
		method: 'POST',
		headers: botHeaders(api.config),
		body: JSON.stringify(body)
	});
}

/** Onboards an account through the same HTTP routes the bot uses. */
export async function onboardLearner(
	api: TestApi,
	input: { telegramId: number; firstName: string; group: Group; code?: string }
): Promise<Response> {
	const invite = await botInvite(api, {
		telegramId: input.telegramId,
		firstName: input.firstName,
		code: input.code ?? api.config.inviteCode
	});
	if (!invite.ok) return invite;
	return botGroup(api, { telegramId: input.telegramId, group: input.group });
}

export function extractSessionCookie(response: Response): string {
	const setCookie = response.headers.get('set-cookie');
	if (!setCookie) throw new Error('The response did not set a session cookie.');
	const match = setCookie.match(/susanin_session=[^;]+/);
	if (!match) throw new Error(`No susanin_session in Set-Cookie: ${setCookie}`);
	return match[0];
}

/** Reads one cookie from a Set-Cookie header, for tests that need a second cookie. */
export function extractCookie(response: Response, name: string): string {
	const setCookie = response.headers.get('set-cookie');
	if (!setCookie) throw new Error('The response did not set any cookie.');
	const match = setCookie.match(new RegExp(`${name}=[^;]+`));
	if (!match) throw new Error(`No ${name} in Set-Cookie: ${setCookie}`);
	return match[0];
}

export async function signIn(
	api: TestApi,
	input: { telegramId: number; firstName: string }
): Promise<{ response: Response; cookie: string }> {
	const initData = makeInitData({
		botToken: api.config.botToken,
		user: { id: input.telegramId, first_name: input.firstName },
		authDateSeconds: Math.floor(api.config.now() / 1000)
	});

	const response = await api.app.request('/api/auth/telegram', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ initData })
	});

	return { response, cookie: response.ok ? extractSessionCookie(response) : '' };
}

export async function getHome(api: TestApi, cookie: string): Promise<Response> {
	return api.app.request('/api/home', { headers: { cookie } });
}
