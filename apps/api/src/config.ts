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
	now: () => number;
};

const FIVE_MINUTES = 5 * 60;

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
		now: () => Date.now()
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
