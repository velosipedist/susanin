export type TelegramOidcConfig = {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	authorizationEndpoint: string;
	tokenEndpoint: string;
	jwksUri: string;
	issuer: string;
};

export type ApiConfig = {
	sessionSecret: string;
	botToken: string;
	botSecret: string;
	inviteCode: string;
	adminIds: number[];
	initDataMaxAgeSeconds: number;
	sessionTtlSeconds: number;
	cookieSecure: boolean;
	devAuth: boolean;
	devTelegramId: number;
	devDisplayName: string;
	databaseFile: string;
	port: number;
	/** Where the browser lands after an admin login. Absolute or rooted. */
	adminAppUrl: string;
	/** Null when the OIDC client credentials are not configured. */
	telegramOidc: TelegramOidcConfig | null;
	now: () => number;
};

const FIVE_MINUTES = 5 * 60;

const TELEGRAM_OIDC_ISSUER = 'https://oauth.telegram.org';
const TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT = 'https://oauth.telegram.org/auth';
const TELEGRAM_OIDC_TOKEN_ENDPOINT = 'https://oauth.telegram.org/token';
const TELEGRAM_OIDC_JWKS_URI = 'https://oauth.telegram.org/.well-known/jwks.json';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
	return {
		sessionSecret: required(env, 'SESSION_SECRET'),
		botToken: required(env, 'TELEGRAM_BOT_TOKEN'),
		botSecret: required(env, 'BOT_API_SECRET'),
		inviteCode: required(env, 'INVITE_CODE'),
		adminIds: parseAdminIds(env.ADMIN_IDS),
		initDataMaxAgeSeconds: numberOrDefault(env.INIT_DATA_MAX_AGE_SECONDS, FIVE_MINUTES),
		sessionTtlSeconds: numberOrDefault(env.SESSION_TTL_SECONDS, 60 * 60 * 24 * 30),
		cookieSecure: env.NODE_ENV === 'production',
		devAuth: env.DEV_AUTH === 'true',
		devTelegramId: numberOrDefault(env.DEV_TELEGRAM_ID, 1),
		devDisplayName: env.DEV_DISPLAY_NAME?.trim() || 'Alex',
		databaseFile: env.DATABASE_FILE?.trim() || './data/susanin.db',
		port: numberOrDefault(env.API_PORT, 3000),
		adminAppUrl: env.ADMIN_APP_URL?.trim() || 'http://localhost:5174/admin/',
		telegramOidc: loadTelegramOidc(env),
		now: () => Date.now()
	};
}

function loadTelegramOidc(env: NodeJS.ProcessEnv): TelegramOidcConfig | null {
	const clientId = env.TELEGRAM_OIDC_CLIENT_ID?.trim();
	const clientSecret = env.TELEGRAM_OIDC_CLIENT_SECRET?.trim();
	const redirectUri = env.ADMIN_OIDC_REDIRECT_URI?.trim();

	if (!clientId || !clientSecret || !redirectUri) return null;

	return {
		clientId,
		clientSecret,
		redirectUri,
		authorizationEndpoint:
			env.TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT?.trim() || TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT,
		tokenEndpoint: env.TELEGRAM_OIDC_TOKEN_ENDPOINT?.trim() || TELEGRAM_OIDC_TOKEN_ENDPOINT,
		jwksUri: env.TELEGRAM_OIDC_JWKS_URI?.trim() || TELEGRAM_OIDC_JWKS_URI,
		issuer: env.TELEGRAM_OIDC_ISSUER?.trim() || TELEGRAM_OIDC_ISSUER
	};
}

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
	}
	return value;
}

function numberOrDefault(value: string | undefined, fallback: number): number {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAdminIds(value: string | undefined): number[] {
	if (!value) return [];
	return value
		.split(',')
		.map((item) => Number(item.trim()))
		.filter((item) => Number.isInteger(item) && item > 0);
}
