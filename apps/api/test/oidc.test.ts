import { createHash } from 'node:crypto';
import {
	createLocalJWKSet,
	exportJWK,
	generateKeyPair,
	SignJWT,
	type CryptoKey,
	type JWK
} from 'jose';
import { describe, expect, it } from 'vitest';
import {
	createPendingOidcLogin,
	createPkcePair,
	createTelegramOidcClient,
	readPendingOidcLogin,
	verifyIdToken
} from '../src/auth/oidc';
import { BASE_NOW } from './helpers';

const ISSUER = 'https://oauth.telegram.org';
const CLIENT_ID = '123456789';

type TestKeys = {
	jwks: ReturnType<typeof createLocalJWKSet>;
	privateKey: CryptoKey;
	otherPrivateKey: CryptoKey;
};

async function testKeys(): Promise<TestKeys> {
	const signing = await generateKeyPair('RS256');
	const other = await generateKeyPair('RS256');

	const publicJwk = await exportJWK(signing.publicKey);
	const jwk: JWK = { ...publicJwk, kid: 'test-key', alg: 'RS256', use: 'sig' };

	return {
		jwks: createLocalJWKSet({ keys: [jwk] }),
		privateKey: signing.privateKey,
		otherPrivateKey: other.privateKey
	};
}

function idToken(
	keys: TestKeys,
	overrides: {
		issuer?: string;
		audience?: string;
		expiresAt?: number;
		now?: number;
		claims?: Record<string, unknown>;
		privateKey?: CryptoKey;
	} = {}
): Promise<string> {
	const now = overrides.now ?? BASE_NOW;

	return new SignJWT(overrides.claims ?? { id: 987654321, given_name: 'Mei' })
		.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
		.setIssuer(overrides.issuer ?? ISSUER)
		.setAudience(overrides.audience ?? CLIENT_ID)
		.setIssuedAt(Math.floor(now / 1000))
		.setExpirationTime(Math.floor((overrides.expiresAt ?? now + 600_000) / 1000))
		.sign(overrides.privateKey ?? keys.privateKey);
}

function verify(keys: TestKeys, token: string) {
	return verifyIdToken(token, {
		jwks: keys.jwks,
		issuer: ISSUER,
		audience: CLIENT_ID,
		now: BASE_NOW
	});
}

describe('Telegram ID token verification', () => {
	it('accepts a token signed by the trusted key and reads the Telegram identity', async () => {
		const keys = await testKeys();

		const identity = await verify(keys, await idToken(keys));

		expect(identity).toEqual({ telegramId: 987654321, firstName: 'Mei' });
	});

	it('rejects a token with the wrong issuer', async () => {
		const keys = await testKeys();

		await expect(
			verify(keys, await idToken(keys, { issuer: 'https://example.com' }))
		).rejects.toThrow('invalid-id-token');
	});

	it('rejects a token for another audience', async () => {
		const keys = await testKeys();

		await expect(verify(keys, await idToken(keys, { audience: '999' }))).rejects.toThrow(
			'invalid-id-token'
		);
	});

	it('rejects an expired token', async () => {
		const keys = await testKeys();

		await expect(
			verify(keys, await idToken(keys, { expiresAt: BASE_NOW - 60_000 }))
		).rejects.toThrow('invalid-id-token');
	});

	it('rejects a token signed by a different key', async () => {
		const keys = await testKeys();

		await expect(
			verify(keys, await idToken(keys, { privateKey: keys.otherPrivateKey }))
		).rejects.toThrow('invalid-id-token');
	});

	it('rejects a token without a usable Telegram identity', async () => {
		const keys = await testKeys();

		await expect(
			verify(keys, await idToken(keys, { claims: { given_name: 'Mei' } }))
		).rejects.toThrow('missing-telegram-id');
	});
});

describe('PKCE pair', () => {
	it('derives a base64url SHA-256 challenge from the verifier', () => {
		const { verifier, challenge } = createPkcePair();
		const expected = createHash('sha256').update(verifier).digest('base64url');

		expect(challenge).toBe(expected);
		expect(verifier).not.toBe(challenge);
	});
});

describe('Telegram OIDC client', () => {
	const config = {
		clientId: '123456789',
		clientSecret: 'client-secret',
		redirectUri: 'https://susanin.test/api/admin/auth/callback',
		authorizationEndpoint: 'https://oauth.test/auth',
		tokenEndpoint: 'https://oauth.test/token',
		jwksUri: 'https://oauth.test/.well-known/jwks.json',
		issuer: ISSUER
	};

	it('builds the authorization URL with the registered redirect and PKCE parameters', () => {
		const client = createTelegramOidcClient(config);

		const url = new URL(
			client.authorizationUrl({ state: 'state-1', codeChallenge: 'challenge-1' })
		);

		expect(url.origin + url.pathname).toBe('https://oauth.test/auth');
		expect(url.searchParams.get('client_id')).toBe('123456789');
		expect(url.searchParams.get('redirect_uri')).toBe(config.redirectUri);
		expect(url.searchParams.get('response_type')).toBe('code');
		expect(url.searchParams.get('scope')).toBe('openid profile');
		expect(url.searchParams.get('state')).toBe('state-1');
		expect(url.searchParams.get('code_challenge')).toBe('challenge-1');
		expect(url.searchParams.get('code_challenge_method')).toBe('S256');
	});

	it('exchanges the authorization code for a verified identity', async () => {
		const keys = await testKeys();
		const token = await idToken(keys, { now: Date.now() });
		const seen: Array<{ url: string; init: RequestInit }> = [];
		const fetchImpl = (async (url: string, init: RequestInit) => {
			seen.push({ url, init });
			return new Response(JSON.stringify({ id_token: token }), {
				headers: { 'content-type': 'application/json' }
			});
		}) as typeof fetch;
		const client = createTelegramOidcClient(config, { fetch: fetchImpl, jwks: keys.jwks });

		const identity = await client.exchange({ code: 'code-1', codeVerifier: 'verifier-1' });

		expect(identity).toEqual({ telegramId: 987654321, firstName: 'Mei' });
		expect(seen).toHaveLength(1);
		expect(seen[0].url).toBe(config.tokenEndpoint);
		expect(String(seen[0].init.body)).toContain('code_verifier=verifier-1');
		expect((seen[0].init.headers as Record<string, string>).authorization).toBe(
			`Basic ${Buffer.from('123456789:client-secret').toString('base64')}`
		);
	});
});

describe('pending OIDC login cookie', () => {
	it('round-trips the state and verifier and rejects tampering or expiry', () => {
		const pending = {
			state: 'state-1',
			codeVerifier: 'verifier-1',
			expiresAt: BASE_NOW + 60_000
		};
		const value = createPendingOidcLogin('secret', pending);

		expect(readPendingOidcLogin('secret', value, BASE_NOW)).toEqual(pending);
		expect(readPendingOidcLogin('other-secret', value, BASE_NOW)).toBeNull();
		expect(readPendingOidcLogin('secret', `${value}tampered`, BASE_NOW)).toBeNull();
		expect(readPendingOidcLogin('secret', value, pending.expiresAt)).toBeNull();
	});
});
