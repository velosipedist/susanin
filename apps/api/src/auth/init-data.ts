import { createHmac, timingSafeEqual } from 'node:crypto';

export type TelegramInitUser = {
	id: number;
	firstName: string;
	username?: string;
};

export type InitDataErrorReason =
	| 'missing-init-data'
	| 'missing-hash'
	| 'bad-hash'
	| 'malformed-user'
	| 'missing-user'
	| 'stale'
	| 'future';

export class InitDataError extends Error {
	readonly reason: InitDataErrorReason;

	constructor(reason: InitDataErrorReason, message: string) {
		super(message);
		this.name = 'InitDataError';
		this.reason = reason;
	}
}

/**
 * Validates Telegram Mini App initData: the HMAC over the data-check-string
 * with the key derived from the bot token, then the auth_date freshness.
 * See https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app.
 */
export function validateInitData(
	initData: string,
	options: { botToken: string; now: number; maxAgeSeconds: number; maxFutureSkewSeconds?: number }
): TelegramInitUser {
	if (!initData.trim()) {
		throw new InitDataError('missing-init-data', 'Telegram initData is missing.');
	}

	const params = new URLSearchParams(initData);
	const receivedHash = params.get('hash');
	if (!receivedHash) {
		throw new InitDataError('missing-hash', 'Telegram initData has no hash.');
	}

	const dataCheckString = [...params.entries()]
		.filter(([key]) => key !== 'hash')
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n');

	const secretKey = createHmac('sha256', 'WebAppData').update(options.botToken).digest();
	const expectedHash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

	if (!constantTimeEqual(expectedHash, receivedHash)) {
		throw new InitDataError('bad-hash', 'Telegram initData signature does not match.');
	}

	const authDate = Number(params.get('auth_date'));
	if (!Number.isFinite(authDate) || authDate <= 0) {
		throw new InitDataError('stale', 'Telegram initData has no auth_date.');
	}

	const nowSeconds = Math.floor(options.now / 1000);
	const maxFutureSkew = options.maxFutureSkewSeconds ?? 60;

	if (authDate > nowSeconds + maxFutureSkew) {
		throw new InitDataError('future', 'Telegram initData is from the future.');
	}

	if (nowSeconds - authDate > options.maxAgeSeconds) {
		throw new InitDataError('stale', 'Telegram initData has expired.');
	}

	const rawUser = params.get('user');
	if (!rawUser) {
		throw new InitDataError('missing-user', 'Telegram initData has no user.');
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawUser);
	} catch {
		throw new InitDataError('malformed-user', 'Telegram initData user is not JSON.');
	}

	if (!isTelegramUser(parsed)) {
		throw new InitDataError('malformed-user', 'Telegram initData user is incomplete.');
	}

	return {
		id: parsed.id,
		firstName: parsed.first_name,
		...(typeof parsed.username === 'string' ? { username: parsed.username } : {})
	};
}

function isTelegramUser(value: unknown): value is {
	id: number;
	first_name: string;
	username?: string;
} {
	if (typeof value !== 'object' || value === null) return false;
	const user = value as Record<string, unknown>;
	return typeof user.id === 'number' && typeof user.first_name === 'string';
}

function constantTimeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) return false;
	return timingSafeEqual(leftBuffer, rightBuffer);
}
