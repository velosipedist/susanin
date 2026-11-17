import { createHmac, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'susanin_session';

export type SessionConfig = {
	sessionSecret: string;
	sessionTtlSeconds: number;
	now: () => number;
	cookieSecure: boolean;
};

/** A signed, expiring session token. The cookie is scoped to /api by the API. */
export function createSessionToken(config: SessionConfig, accountId: number): string {
	const expiresAt = Math.floor(config.now() / 1000) + config.sessionTtlSeconds;
	const payload = `${accountId}.${expiresAt}`;
	return `${payload}.${sign(config.sessionSecret, payload)}`;
}

/** Returns the account id, or null when the token is missing, tampered or expired. */
export function readSessionToken(config: SessionConfig, token: string | undefined): number | null {
	if (!token) return null;

	const parts = token.split('.');
	if (parts.length !== 3) return null;

	const [rawAccountId, rawExpiresAt, signature] = parts;
	const accountId = Number(rawAccountId);
	const expiresAt = Number(rawExpiresAt);

	if (!Number.isInteger(accountId) || accountId <= 0) return null;
	if (!Number.isFinite(expiresAt) || expiresAt <= Math.floor(config.now() / 1000)) return null;

	const expected = sign(config.sessionSecret, `${rawAccountId}.${rawExpiresAt}`);
	if (!constantTimeEqual(expected, signature)) return null;

	return accountId;
}

function sign(secret: string, payload: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}

function constantTimeEqual(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	if (leftBuffer.length !== rightBuffer.length) return false;
	return timingSafeEqual(leftBuffer, rightBuffer);
}
