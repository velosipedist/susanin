import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { FIELD_STATE_VALUES, GROUPS, isGroup, isGroupRunKind } from '@susanin/shared';
import { InitDataError, validateInitData, type TelegramInitUser } from './auth/init-data';
import { SESSION_COOKIE, createSessionToken, readSessionToken } from './auth/session';
import type { ApiConfig } from './config';
import { constantTimeEqual } from './constant-time';
import type { SusaninDatabase } from './db';
import { accounts } from './db/schema';
import { loadHome } from './home';
import { gradeTopic, loadGroupRun, loadSectionRun } from './runs';
import {
	chooseGroup,
	findAccountById,
	findAccountByTelegramId,
	startOnboarding,
	submitInvite
} from './onboarding';

export type ApiContext = {
	db: SusaninDatabase;
	config: ApiConfig;
};

const botUserSchema = z.object({
	telegramId: z.number().int().positive(),
	firstName: z.string().trim().min(1).max(100)
});

const inviteSchema = botUserSchema.extend({ code: z.string().min(1) });

const groupSchema = z.object({ telegramId: z.number().int().positive(), group: z.enum(GROUPS) });

const authSchema = z.object({ initData: z.string() });

const verdictsSchema = z.object({
	verdicts: z.record(z.string(), z.enum(FIELD_STATE_VALUES))
});

export function createApp({ db, config }: ApiContext): Hono {
	const app = new Hono();

	app.get('/api/health', (c) => c.json({ ok: true }));

	app.post('/api/auth/telegram', async (c) => {
		const parsed = authSchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: 'invalid-request' }, 400);
		}

		let user: TelegramInitUser;
		try {
			user = validateInitData(parsed.data.initData, {
				botToken: config.botToken,
				now: config.now(),
				maxAgeSeconds: config.initDataMaxAgeSeconds
			});
		} catch (error) {
			if (error instanceof InitDataError) {
				return c.json({ error: 'invalid-init-data', reason: error.reason }, 401);
			}
			throw error;
		}

		const account = findAccountByTelegramId(db, user.id);
		if (!account) {
			return c.json({ error: 'onboarding-required' }, 403);
		}

		if (!account.groupName) {
			return c.json({ error: 'group-required' }, 403);
		}

		const displayName = user.firstName.trim() || account.displayName;
		const isAdmin = config.adminIds.includes(user.id);
		if (displayName !== account.displayName || isAdmin !== account.isAdmin) {
			db.update(accounts)
				.set({ displayName, isAdmin })
				.where(eq(accounts.id, account.id))
				.run();
		}

		setSessionCookie(c, config, account.id);
		return c.json({ ok: true });
	});

	app.get('/api/home', (c) => {
		const account = sessionAccount(c, db, config);
		if (!account) {
			return c.json({ error: 'unauthorized' }, 401);
		}

		if (!isGroup(account.groupName)) {
			return c.json({ error: 'group-required' }, 403);
		}

		return c.json(loadHome(db, account, account.groupName));
	});

	app.get('/api/runs/:kind', (c) => {
		const account = sessionAccount(c, db, config);
		if (!account) {
			return c.json({ error: 'unauthorized' }, 401);
		}

		if (!isGroup(account.groupName)) {
			return c.json({ error: 'group-required' }, 403);
		}

		const kind = c.req.param('kind');
		if (!isGroupRunKind(kind)) {
			return c.json({ error: 'run-not-found' }, 404);
		}

		return c.json(
			loadGroupRun(db, { accountId: account.id, group: account.groupName, kind })
		);
	});

	app.get('/api/sections/:number/cards', (c) => {
		const account = sessionAccount(c, db, config);
		if (!account) {
			return c.json({ error: 'unauthorized' }, 401);
		}

		const sectionNumber = Number(c.req.param('number'));
		if (!Number.isInteger(sectionNumber) || sectionNumber < 1) {
			return c.json({ error: 'section-not-found' }, 404);
		}

		const run = loadSectionRun(db, sectionNumber);
		if (!run) {
			return c.json({ error: 'section-not-found' }, 404);
		}

		return c.json(run);
	});

	app.post('/api/topics/:topicId/progress', async (c) => {
		const account = sessionAccount(c, db, config);
		if (!account) {
			return c.json({ error: 'unauthorized' }, 401);
		}

		const topicId = Number(c.req.param('topicId'));
		if (!Number.isInteger(topicId) || topicId < 1) {
			return c.json({ error: 'topic-not-found' }, 404);
		}

		const parsed = verdictsSchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: 'invalid-verdicts' }, 400);
		}

		const result = gradeTopic(db, {
			accountId: account.id,
			topicId,
			gradedAt: config.now(),
			verdicts: parsed.data.verdicts
		});

		switch (result.status) {
			case 'not-found':
				return c.json({ error: 'topic-not-found' }, 404);
			case 'no-fields':
				return c.json({ error: 'no-gradeable-fields' }, 400);
			case 'incomplete':
				return c.json({ error: 'incomplete-card' }, 400);
			default:
				return c.json({ ok: true });
		}
	});

	app.use('/api/bot/*', async (c, next) => {
		const provided = c.req.header('x-bot-secret') ?? '';
		if (!constantTimeEqual(provided, config.botSecret)) {
			return c.json({ error: 'unauthorized' }, 401);
		}
		await next();
	});

	app.post('/api/bot/start', async (c) => {
		const parsed = botUserSchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: 'invalid-request' }, 400);
		}

		return c.json(startOnboarding(db, config, parsed.data));
	});

	app.post('/api/bot/invite', async (c) => {
		const parsed = inviteSchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: 'invalid-request' }, 400);
		}

		const result = submitInvite(db, config, parsed.data);
		switch (result.status) {
			case 'invalid':
				return c.json(result, 401);
			case 'rate-limited':
				return c.json(result, 429);
			default:
				return c.json(result);
		}
	});

	app.post('/api/bot/group', async (c) => {
		const parsed = groupSchema.safeParse(await readJson(c.req.raw));
		if (!parsed.success) {
			return c.json({ error: 'invalid-request' }, 400);
		}

		const ok = chooseGroup(db, parsed.data);
		if (!ok) {
			return c.json({ error: 'onboarding-required' }, 404);
		}

		return c.json({ status: 'ready', group: parsed.data.group });
	});

	app.post('/api/dev/session', (c) => {
		if (!config.devAuth) {
			return c.json({ error: 'not-found' }, 404);
		}

		const account = findAccountByTelegramId(db, config.devTelegramId);
		if (!account?.groupName) {
			return c.json({ error: 'dev-account-missing' }, 404);
		}

		setSessionCookie(c, config, account.id);
		return c.json({ ok: true });
	});

	return app;
}

function sessionAccount(c: Context, db: SusaninDatabase, config: ApiConfig) {
	const token = getCookie(c, SESSION_COOKIE);
	const accountId = readSessionToken(config, token);
	if (!accountId) return undefined;
	return findAccountById(db, accountId);
}

function setSessionCookie(c: Context, config: ApiConfig, accountId: number): void {
	setCookie(c, SESSION_COOKIE, createSessionToken(config, accountId), {
		path: '/api',
		httpOnly: true,
		sameSite: 'Lax',
		secure: config.cookieSecure,
		maxAge: config.sessionTtlSeconds
	});
}

async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
