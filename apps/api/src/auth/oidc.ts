import { createHash, createHmac, randomBytes } from 'node:crypto';
import {
	createRemoteJWKSet,
	jwtVerify,
	type JWTVerifyGetKey
} from 'jose';
import type { TelegramOidcConfig } from '../config';
import { constantTimeEqual } from '../constant-time';

/** The identity an OIDC login proves. Only the Telegram id is required. */
export type OidcIdentity = {
	telegramId: number;
	firstName: string;
};

/**
 * The two calls the admin login makes to Telegram. The app receives an
 * implementation through its dependencies so tests can drive the flow without
 * the network.
 */
export type OidcClient = {
	authorizationUrl(input: { state: string; codeChallenge: string }): string;
	exchange(input: { code: string; codeVerifier: string }): Promise<OidcIdentity>;
};

/** Stored in a short-lived signed cookie between `login` and `callback`. */
export type PendingOidcLogin = {
	state: string;
	codeVerifier: string;
	expiresAt: number;
};

export class OidcError extends Error {
	constructor(readonly reason: string) {
		super(reason);
		this.name = 'OidcError';
	}
}

const ID_TOKEN_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'];

/** A PKCE verifier and its S256 challenge, both base64url. */
export function createPkcePair(): { verifier: string; challenge: string } {
	const verifier = randomBytes(32).toString('base64url');
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	return { verifier, challenge };
}

export function createOidcState(): string {
	return randomBytes(24).toString('base64url');
}

export function createTelegramOidcClient(
	config: TelegramOidcConfig,
	options: { fetch?: typeof fetch; jwks?: JWTVerifyGetKey } = {}
): OidcClient {
	const fetchImpl = options.fetch ?? fetch;
	const jwks = options.jwks ?? createRemoteJWKSet(new URL(config.jwksUri));

	return {
		authorizationUrl({ state, codeChallenge }) {
			const url = new URL(config.authorizationEndpoint);
			url.searchParams.set('client_id', config.clientId);
			url.searchParams.set('redirect_uri', config.redirectUri);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('scope', 'openid profile');
			url.searchParams.set('state', state);
			url.searchParams.set('code_challenge', codeChallenge);
			url.searchParams.set('code_challenge_method', 'S256');
			return url.toString();
		},

		async exchange({ code, codeVerifier }) {
			const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString(
				'base64'
			);
			const response = await fetchImpl(config.tokenEndpoint, {
				method: 'POST',
				headers: {
					'content-type': 'application/x-www-form-urlencoded',
					authorization: `Basic ${credentials}`
				},
				body: new URLSearchParams({
					grant_type: 'authorization_code',
					code,
					redirect_uri: config.redirectUri,
					client_id: config.clientId,
					code_verifier: codeVerifier
				})
			});

			if (!response.ok) {
				throw new OidcError('token-exchange-failed');
			}

			const tokens = (await response.json()) as { id_token?: unknown };
			if (typeof tokens.id_token !== 'string') {
				throw new OidcError('missing-id-token');
			}

			return verifyIdToken(tokens.id_token, {
				jwks,
				issuer: config.issuer,
				audience: config.clientId
			});
		}
	};
}

/** Verifies a Telegram `id_token` and returns the identity it certifies. */
export async function verifyIdToken(
	idToken: string,
	options: {
		jwks: JWTVerifyGetKey;
		issuer: string;
		audience: string;
		now?: number;
	}
): Promise<OidcIdentity> {
	let payload: Record<string, unknown>;

	try {
		const verified = await jwtVerify(idToken, options.jwks, {
			issuer: options.issuer,
			audience: options.audience,
			algorithms: ID_TOKEN_ALGORITHMS,
			currentDate: new Date(options.now ?? Date.now())
		});
		payload = verified.payload;
	} catch {
		throw new OidcError('invalid-id-token');
	}

	const telegramId = typeof payload.id === 'number' ? payload.id : Number(payload.sub);
	if (!Number.isInteger(telegramId) || telegramId <= 0) {
		throw new OidcError('missing-telegram-id');
	}

	return {
		telegramId,
		firstName: firstNameFromClaims(payload)
	};
}

/** Signs the state and verifier that travel in the login cookie. */
export function createPendingOidcLogin(secret: string, pending: PendingOidcLogin): string {
	const payload = Buffer.from(JSON.stringify(pending)).toString('base64url');
	return `${payload}.${sign(secret, payload)}`;
}

/** Returns null when the pending login is missing, tampered with or expired. */
export function readPendingOidcLogin(
	secret: string,
	value: string | undefined,
	now: number
): PendingOidcLogin | null {
	if (!value) return null;

	const parts = value.split('.');
	if (parts.length !== 2) return null;

	const [payload, signature] = parts;
	if (!constantTimeEqual(sign(secret, payload), signature)) return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		return null;
	}

	if (!isPendingOidcLogin(parsed) || parsed.expiresAt <= now) return null;
	return parsed;
}

function sign(secret: string, payload: string): string {
	return createHmac('sha256', secret).update(payload).digest('base64url');
}

function isPendingOidcLogin(value: unknown): value is PendingOidcLogin {
	if (typeof value !== 'object' || value === null) return false;
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.state === 'string' &&
		typeof candidate.codeVerifier === 'string' &&
		typeof candidate.expiresAt === 'number'
	);
}

function firstNameFromClaims(payload: Record<string, unknown>): string {
	if (typeof payload.given_name === 'string' && payload.given_name.trim()) {
		return payload.given_name.trim();
	}
	if (typeof payload.name === 'string') {
		return payload.name.trim().split(/\s+/)[0] ?? '';
	}
	return '';
}
