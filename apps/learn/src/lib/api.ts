import type { HomeResponse } from '@susanin/shared';
import { telegramWebApp } from './telegram';

export type HomeResult =
	| { status: 'ready'; home: HomeResponse }
	| { status: 'onboarding-required' | 'group-required' | 'signed-out' | 'unavailable' };

/**
 * Exchanges the Mini App's Telegram initData for the signed session cookie,
 * then reads the account's home from the API. In a plain browser the API's
 * local dev session is tried instead; it is enabled only when DEV_AUTH is on.
 */
export async function loadLearnerHome(): Promise<HomeResult> {
	const initData = telegramWebApp()?.initData ?? '';

	if (initData) {
		const auth = await post('/api/auth/telegram', { initData });
		if (!auth.ok) {
			return { status: await authFailure(auth) };
		}
	} else {
		const dev = await post('/api/dev/session', {});
		if (!dev.ok) {
			return { status: dev.status === 404 ? 'signed-out' : 'unavailable' };
		}
	}

	const response = await fetch('/api/home', { credentials: 'same-origin' });
	if (!response.ok) {
		return {
			status: response.status === 403 ? await authFailure(response) : 'unavailable'
		};
	}

	return { status: 'ready', home: (await response.json()) as HomeResponse };
}

async function post(path: string, body: unknown): Promise<Response> {
	try {
		return await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
			credentials: 'same-origin'
		});
	} catch {
		return new Response(null, { status: 503 });
	}
}

async function authFailure(
	response: Response
): Promise<'onboarding-required' | 'group-required' | 'signed-out'> {
	const body = (await response.json().catch(() => null)) as { error?: string } | null;

	if (body?.error === 'onboarding-required') return 'onboarding-required';
	if (body?.error === 'group-required') return 'group-required';
	return 'signed-out';
}
