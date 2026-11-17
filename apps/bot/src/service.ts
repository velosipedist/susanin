import { isGroup, type Group } from '@susanin/shared';

export type BotStartResult = {
	stage: 'awaiting-invite' | 'choosing-group' | 'ready';
	group?: Group;
};

export type InviteResult = 'joined' | 'already-member' | 'invalid' | 'rate-limited';

export class SusaninServiceError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'SusaninServiceError';
		this.status = status;
	}
}

/** The bot's client for the Susanin API. All account state lives there. */
export class SusaninService {
	readonly #baseUrl: string;
	readonly #secret: string;

	constructor(baseUrl: string, secret: string) {
		this.#baseUrl = baseUrl.replace(/\/+$/, '');
		this.#secret = secret;
	}

	async start(input: { telegramId: number; firstName: string }): Promise<BotStartResult> {
		const body = await this.#post<{ stage: string; group?: string }>('/api/bot/start', input);
		if (body.stage !== 'awaiting-invite' && body.stage !== 'choosing-group' && body.stage !== 'ready') {
			throw new SusaninServiceError(`Unknown onboarding stage: ${body.stage}`, 500);
		}

		return {
			stage: body.stage,
			group: isGroup(body.group) ? body.group : undefined
		};
	}

	async invite(input: {
		telegramId: number;
		firstName: string;
		code: string;
	}): Promise<InviteResult> {
		const response = await this.#request('/api/bot/invite', input);
		const body = (await response.json().catch(() => null)) as { status?: string } | null;

		switch (body?.status) {
			case 'joined':
			case 'already-member':
			case 'invalid':
			case 'rate-limited':
				return body.status;
			default:
				throw new SusaninServiceError(
					`Invite exchange failed with HTTP ${response.status}.`,
					response.status
				);
		}
	}

	async chooseGroup(input: { telegramId: number; group: Group }): Promise<boolean> {
		const response = await this.#request('/api/bot/group', input);
		if (response.status === 404) return false;
		if (!response.ok) {
			throw new SusaninServiceError(
				`Group choice failed with HTTP ${response.status}.`,
				response.status
			);
		}
		return true;
	}

	async #post<T>(path: string, body: unknown): Promise<T> {
		const response = await this.#request(path, body);
		if (!response.ok) {
			throw new SusaninServiceError(
				`Susanin API ${path} failed with HTTP ${response.status}.`,
				response.status
			);
		}
		return (await response.json()) as T;
	}

	async #request(path: string, body: unknown): Promise<Response> {
		return fetch(`${this.#baseUrl}${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-bot-secret': this.#secret
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(10_000)
		});
	}
}
