import { constantTimeEqual } from '../constant-time';
import { signPayload } from './sign';

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
	return `${payload}.${signPayload(config.sessionSecret, payload)}`;
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

	const expected = signPayload(config.sessionSecret, `${rawAccountId}.${rawExpiresAt}`);
	if (!constantTimeEqual(expected, signature)) return null;

	return accountId;
}
