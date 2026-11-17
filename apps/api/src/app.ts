import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { FIELD_STATE_VALUES, GROUPS, isGroup, isGroupRunKind } from '@susanin/shared';
import { isAdminAccount, loadDashboard } from './admin';
import { InitDataError, validateInitData, type TelegramInitUser } from './auth/init-data';
import {
	createOidcState,
	createPendingOidcLogin,
	createPkcePair,
	createTelegramOidcClient,
	readPendingOidcLogin,
	type OidcClient,
	type OidcIdentity
} from './auth/oidc';
import { SESSION_COOKIE, createSessionToken, readSessionToken } from './auth/session';
import type { ApiConfig } from './config';
import { constantTimeEqual } from './constant-time';
import type { SusaninDatabase } from './db';
import { accounts } from './db/schema';
import { loadHome, loadSectionList } from './home';
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
	/** Tests inject a fake; the app builds the Telegram client when omitted. */
	oidc?: OidcClient | null;
};

const OIDC_COOKIE = 'susanin_oidc';
const OIDC_COOKIE_PATH = '/api/admin/auth';
const OIDC_COOKIE_TTL_SECONDS = 10 * 60;

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

export function createApp({ db, config, oidc: providedOidc }: ApiContext): Hono {
	const app = new Hono();
	const oidc = providedOidc === undefined ? defaultOidcClient(config) : providedOidc;

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

	app.get('/api/sections', (c) => {
		const account = sessionAccount(c, db, config);
		if (!account) {
			return c.json({ error: 'unauthorized' }, 401);
		}

		if (!isGroup(account.groupName)) {
			return c.json({ error: 'group-required' }, 403);
		}

		return c.json(loadSectionList(db, account, account.groupName));
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

		const sectionNumber = routeId(c.req.param('number'));
		if (sectionNumber === undefined) {
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

		const topicId = routeId(c.req.param('topicId'));
		if (topicId === undefined) {
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
			case 'ok':
				return c.json({ ok: true });
			case 'not-found':
				return c.json({ error: 'topic-not-found' }, 404);
			case 'no-fields':
				return c.json({ error: 'no-gradeable-fields' }, 400);
			case 'incomplete':
				return c.json({ error: 'incomplete-card' }, 400);
		}
	});

	app.get('/api/admin/auth/login', (c) => {
		if (!oidc) {
			return c.json({ error: 'admin-login-unavailable' }, 503);
		}

		const { verifier, challenge } = createPkcePair();
		const state = createOidcState();

		setCookie(
			c,
			OIDC_COOKIE,
			createPendingOidcLogin(config.sessionSecret, {
				state,
				codeVerifier: verifier,
				expiresAt: config.now() + OIDC_COOKIE_TTL_SECONDS * 1000
			}),
			{
				path: OIDC_COOKIE_PATH,
				httpOnly: true,
				sameSite: 'Lax',
				secure: config.cookieSecure,
				maxAge: OIDC_COOKIE_TTL_SECONDS
			}
		);

		return c.redirect(oidc.authorizationUrl({ state, codeChallenge: challenge }));
	});

	app.get('/api/admin/auth/callback', async (c) => {
		if (!oidc) {
			return c.redirect(adminLanding(config, 'login-unavailable'));
		}

		const pending = readPendingOidcLogin(
			config.sessionSecret,
			getCookie(c, OIDC_COOKIE),
			config.now()
		);
		deleteCookie(c, OIDC_COOKIE, { path: OIDC_COOKIE_PATH });

		const code = c.req.query('code');
		const state = c.req.query('state');

		if (!pending || !code || !state || !constantTimeEqual(pending.state, state)) {
			return c.redirect(adminLanding(config, 'login-failed'));
		}

		let identity: OidcIdentity;
		try {
			identity = await oidc.exchange({ code, codeVerifier: pending.codeVerifier });
		} catch {
			return c.redirect(adminLanding(config, 'login-failed'));
		}

		const account = findAccountByTelegramId(db, identity.telegramId);
		if (!account) {
			return c.redirect(adminLanding(config, 'not-invited'));
		}

		const displayName = identity.firstName.trim() || account.displayName;
		if (displayName !== account.displayName) {
			db.update(accounts)
				.set({ displayName })
				.where(eq(accounts.id, account.id))
				.run();
		}

		setSessionCookie(c, config, account.id);
		return c.redirect(adminLanding(config));
	});

	app.get('/api/admin/session', (c) => {
		const account = sessionAccount(c, db, config);
		if (!account) {
			return c.json({ error: 'unauthorized' }, 401);
		}

		return c.json({
			account: {
				telegramId: account.telegramId,
				displayName: account.displayName,
				group: isGroup(account.groupName) ? account.groupName : null,
				isAdmin: isAdminAccount(account, config)
			}
		});
	});

	app.get('/api/admin/dashboard', (c) => {
		const denied = requireAdmin(c, db, config);
		if (denied) return denied;

		return c.json(loadDashboard(db));
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

/** The real Telegram client; null when the OIDC credentials are absent. */
function defaultOidcClient(config: ApiConfig): OidcClient | null {
	return config.telegramOidc ? createTelegramOidcClient(config.telegramOidc) : null;
}

function sessionAccount(c: Context, db: SusaninDatabase, config: ApiConfig) {
	const token = getCookie(c, SESSION_COOKIE);
	const accountId = readSessionToken(config, token);
	if (!accountId) return undefined;
	return findAccountById(db, accountId);
}

/**
 * The authorization gate for every admin data route. Hiding a screen is never
 * the control: a direct call without an admin session is refused here. Returns
 * the refusal response, or null when the caller may proceed.
 */
function requireAdmin(c: Context, db: SusaninDatabase, config: ApiConfig): Response | null {
	const account = sessionAccount(c, db, config);
	if (!account) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	if (!isAdminAccount(account, config)) {
		return c.json({ error: 'forbidden' }, 403);
	}
	return null;
}

/** The admin SPA's URL, with an optional login outcome the shell can explain. */
function adminLanding(config: ApiConfig, error?: string): string {
	const url = new URL(config.adminAppUrl);
	if (error) url.searchParams.set('error', error);
	return url.toString();
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

/** Parses a route id; anything that is not a positive whole number is invalid. */
function routeId(value: string): number | undefined {
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
