import type {
	GroupRunKind,
	HomeResponse,
	Run,
	SectionListResponse,
	SectionRun,
	Verdicts
} from '@susanin/shared';
import { telegramWebApp } from './telegram';

type SessionStatus = 'onboarding-required' | 'group-required' | 'signed-out' | 'unavailable';

export type HomeResult =
	| { status: 'ready'; home: HomeResponse }
	| { status: SessionStatus };

export type SectionListResult =
	| { status: 'ready'; list: SectionListResponse }
	| { status: SessionStatus };

/**
 * Exchanges the Mini App's Telegram initData for the signed session cookie.
 * In a plain browser the API's local dev session is tried instead; it is
 * enabled only when DEV_AUTH is on.
 */
async function openSession(): Promise<SessionStatus | 'ok'> {
	const initData = telegramWebApp()?.initData ?? '';

	if (initData) {
		const auth = await post('/api/auth/telegram', { initData });
		return auth.ok ? 'ok' : authFailure(auth);
	}

	const dev = await post('/api/dev/session', {});
	if (dev.ok) return 'ok';
	return dev.status === 404 ? 'signed-out' : 'unavailable';
}

/** Authenticates the Mini App, then reads the account's home. */
export async function loadLearnerHome(): Promise<HomeResult> {
	const session = await openSession();
	if (session !== 'ok') return { status: session };

	return loadHomeForSession();
}

/** Reads the home again over the existing session cookie, without re-authenticating. */
export async function loadHomeForSession(): Promise<HomeResult> {
	const response = await request('/api/home');

	if (!response.ok) {
		return {
			status: response.status === 403 ? await authFailure(response) : 'unavailable'
		};
	}

	return { status: 'ready', home: (await response.json()) as HomeResponse };
}

/** Reads all 25 sections, marking the account's group in scope. */
export async function loadSectionList(): Promise<SectionListResult> {
	const session = await openSession();
	if (session !== 'ok') return { status: session };

	const response = await request('/api/sections');

	if (!response.ok) {
		return {
			status: response.status === 403 ? await authFailure(response) : 'unavailable'
		};
	}

	return { status: 'ready', list: (await response.json()) as SectionListResponse };
}

type LoadedRun<T> =
	| { status: 'ready'; run: T }
	| { status: 'empty' | 'signed-out' | 'unavailable' };

export type SectionRunResult = LoadedRun<SectionRun>;

/** Loads one section's cards in route order; topics without gradeable fields are absent. */
export async function loadSectionRun(sectionNumber: number): Promise<SectionRunResult> {
	return loadRun<SectionRun>(`/api/sections/${sectionNumber}/cards`);
}

export type GroupRunResult = LoadedRun<Run>;

/** Loads Learn new (every group section) or Repeat gaps (sections with gaps). */
export async function loadGroupRun(kind: GroupRunKind): Promise<GroupRunResult> {
	return loadRun<Run>(`/api/runs/${kind}`);
}

/** Reads a run response, distinguishing an empty run from a failed load. */
async function loadRun<T extends { cards: unknown[] }>(path: string): Promise<LoadedRun<T>> {
	const response = await request(path);

	if (!response.ok) {
		return { status: response.status === 401 ? 'signed-out' : 'unavailable' };
	}

	const run = (await response.json()) as T;
	return run.cards.length === 0 ? { status: 'empty' } : { status: 'ready', run };
}

export type SaveProgressResult = 'ok' | 'rejected' | 'unavailable';

/** Writes a whole card's verdicts; the API refuses anything partial. */
export async function saveTopicProgress(
	topicId: number,
	verdicts: Verdicts
): Promise<SaveProgressResult> {
	const response = await request(`/api/topics/${topicId}/progress`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ verdicts })
	});

	if (response.ok) return 'ok';
	return response.status === 400 ? 'rejected' : 'unavailable';
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
	try {
		return await fetch(path, { credentials: 'same-origin', ...init });
	} catch {
		return new Response(null, { status: 503 });
	}
}

async function post(path: string, body: unknown): Promise<Response> {
	return request(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

async function authFailure(
	response: Response
): Promise<'onboarding-required' | 'group-required' | 'signed-out'> {
	const body = (await response.json().catch(() => null)) as { error?: string } | null;

	if (body?.error === 'onboarding-required') return 'onboarding-required';
	if (body?.error === 'group-required') return 'group-required';
	return 'signed-out';
}
