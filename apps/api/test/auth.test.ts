import { describe, expect, it } from 'vitest';
import { BASE_NOW, createTestApi, getHome, makeInitData, onboardLearner, signIn } from './helpers';

describe('Telegram initData exchange and the session cookie', () => {
	it('rejects an unsigned or tampered initData payload', async () => {
		const api = createTestApi();

		const response = await api.app.request('/api/auth/telegram', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ initData: 'query_id=x&user=%7B%7D&auth_date=1&hash=deadbeef' })
		});

		expect(response.status).toBe(401);
		api.close();
	});

	it('rejects initData older than the freshness window', async () => {
		const api = createTestApi();
		const initData = makeInitData({
			botToken: api.config.botToken,
			user: { id: 6001, first_name: 'Mei' },
			authDateSeconds: Math.floor(BASE_NOW / 1000) - 3600
		});

		const response = await api.app.request('/api/auth/telegram', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ initData })
		});

		expect(response.status).toBe(401);
		const body = (await response.json()) as { reason?: string };
		expect(body.reason).toBe('stale');
		api.close();
	});

	it('rejects initData signed with a different bot token', async () => {
		const api = createTestApi();
		const initData = makeInitData({
			botToken: '999:another-token',
			user: { id: 6002, first_name: 'Mei' },
			authDateSeconds: Math.floor(BASE_NOW / 1000)
		});

		const response = await api.app.request('/api/auth/telegram', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ initData })
		});

		expect(response.status).toBe(401);
		api.close();
	});

	it('refuses a valid identity that has not onboarded', async () => {
		const api = createTestApi();

		const { response } = await signIn(api, { telegramId: 6003, firstName: 'Mei' });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'onboarding-required' });
		api.close();
	});

	it('refuses an onboarded account until a group is chosen', async () => {
		const api = createTestApi();
		await api.app.request('/api/bot/invite', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-bot-secret': api.config.botSecret },
			body: JSON.stringify({
				telegramId: 6004,
				firstName: 'Mei',
				code: api.config.inviteCode
			})
		});

		const { response } = await signIn(api, { telegramId: 6004, firstName: 'Mei' });

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: 'group-required' });
		api.close();
	});

	it('sets a signed cookie that home accepts, and refuses a tampered cookie', async () => {
		const api = createTestApi();
		await onboardLearner(api, { telegramId: 6005, firstName: 'Mei', group: 'B' });

		const { response, cookie } = await signIn(api, { telegramId: 6005, firstName: 'Mei' });
		expect(response.status).toBe(200);

		const home = await getHome(api, cookie);
		expect(home.status).toBe(200);

		const tampered = cookie.replace(/susanin_session=([^.]*)\./, 'susanin_session=999999.');
		const refused = await getHome(api, tampered);
		expect(refused.status).toBe(401);
		api.close();
	});

	it('refuses home without a session', async () => {
		const api = createTestApi();

		const response = await api.app.request('/api/home');

		expect(response.status).toBe(401);
		api.close();
	});
});
