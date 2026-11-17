import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { openDatabase } from '../src/db';
import { seedContent } from '../src/db/seed';
import {
	BASE_NOW,
	botGroup,
	botInvite,
	botStart,
	createTestApi,
	testConfig
} from './helpers';

describe('bot onboarding over HTTP', () => {
	it('asks an unknown account for the invite code', async () => {
		const api = createTestApi();

		const response = await botStart(api, { telegramId: 5001, firstName: 'Mei' });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ stage: 'awaiting-invite' });
		api.close();
	});

	it('rejects a wrong code and remembers the failure without creating an account', async () => {
		const api = createTestApi();

		const rejected = await botInvite(api, {
			telegramId: 5002,
			firstName: 'Mei',
			code: 'not-the-code'
		});

		expect(rejected.status).toBe(401);
		expect(await rejected.json()).toEqual({ status: 'invalid' });

		const start = await botStart(api, { telegramId: 5002, firstName: 'Mei' });
		expect(await start.json()).toEqual({ stage: 'awaiting-invite' });
		api.close();
	});

	it('creates an account on the configured code, then requires a group', async () => {
		const api = createTestApi();

		const joined = await botInvite(api, {
			telegramId: 5003,
			firstName: 'Mei',
			code: api.config.inviteCode
		});
		expect(joined.status).toBe(200);
		expect(await joined.json()).toEqual({ status: 'joined' });

		const beforeGroup = await botStart(api, { telegramId: 5003, firstName: 'Mei' });
		expect(await beforeGroup.json()).toEqual({ stage: 'choosing-group' });

		const chosen = await botGroup(api, { telegramId: 5003, group: 'C' });
		expect(chosen.status).toBe(200);
		expect(await chosen.json()).toEqual({ status: 'ready', group: 'C' });

		const afterGroup = await botStart(api, { telegramId: 5003, firstName: 'Mei' });
		expect(await afterGroup.json()).toEqual({ stage: 'ready', group: 'C' });
		api.close();
	});

	it('skips the code for a known account after the API restarts', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'susanin-onboarding-'));
		const file = join(directory, 'test.db');
		const config = testConfig({ databaseFile: file, now: () => BASE_NOW });

		const first = openDatabase(file);
		seedContent(first.db);
		const firstApp = createApp({ db: first.db, config });
		await firstApp.request('/api/bot/invite', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-bot-secret': config.botSecret },
			body: JSON.stringify({ telegramId: 5004, firstName: 'Mei', code: config.inviteCode })
		});
		await firstApp.request('/api/bot/group', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-bot-secret': config.botSecret },
			body: JSON.stringify({ telegramId: 5004, group: 'A' })
		});
		first.close();

		const second = openDatabase(file);
		const secondApp = createApp({ db: second.db, config });
		const response = await secondApp.request('/api/bot/start', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-bot-secret': config.botSecret },
			body: JSON.stringify({ telegramId: 5004, firstName: 'Mei' })
		});

		expect(await response.json()).toEqual({ stage: 'ready', group: 'A' });
		second.close();
	});

	it('refuses further attempts after twenty failures in an hour, then allows a correct code later', async () => {
		let now = BASE_NOW;
		const api = createTestApi({ now: () => now });

		for (let attempt = 0; attempt < 20; attempt += 1) {
			const response = await botInvite(api, {
				telegramId: 5005,
				firstName: 'Mei',
				code: `wrong-${attempt}`
			});
			expect(response.status).toBe(401);
		}

		const refused = await botInvite(api, {
			telegramId: 5005,
			firstName: 'Mei',
			code: api.config.inviteCode
		});
		expect(refused.status).toBe(429);
		expect(await refused.json()).toEqual({ status: 'rate-limited' });

		now += 60 * 60 * 1000 + 1;

		const allowed = await botInvite(api, {
			telegramId: 5005,
			firstName: 'Mei',
			code: api.config.inviteCode
		});
		expect(allowed.status).toBe(200);
		expect(await allowed.json()).toEqual({ status: 'joined' });
		api.close();
	});

	it('rejects bot routes without the bot secret', async () => {
		const api = createTestApi();

		const response = await api.app.request('/api/bot/start', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ telegramId: 5006, firstName: 'Mei' })
		});

		expect(response.status).toBe(401);
		api.close();
	});
});
