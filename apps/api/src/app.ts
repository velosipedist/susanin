import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { GROUPS, type Group } from '@susanin/shared';
import { InitDataError, validateInitData } from './auth/init-data';
import { SESSION_COOKIE, createSessionToken, readSessionToken } from './auth/session';
import type { ApiConfig } from './config';
import type { SusaninDatabase } from './db';
import { accounts } from './db/schema';
import { loadHome } from './home';
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

export function createApp({ db, config }: ApiContext): Hono {
	const app = new Hono();

	app.get('/api/health', (c) => c.json({ ok: true }));

	app.post('/api/auth/telegram', async (c) => {
		const body = await readJson(c.req.raw);
		const parsed = authSchema.safeParse(body);
		if (!parsed.success) {
			return c.json({ error: 'invalid-request' }, 400);
		}

		let user;
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

		if (!account.groupName) {
			return c.json({ error: 'group-required' }, 403);
		}

		return c.json(loadHome(db, account));
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

		return c.json({ status: 'ready', group: parsed.data.group as Group });
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

function constantTimeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) return false;
	return timingSafeEqual(leftBuffer, rightBuffer);
}
