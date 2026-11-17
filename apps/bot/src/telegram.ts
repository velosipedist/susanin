export type TelegramUser = {
	id: number;
	first_name: string;
	username?: string;
};

export type TelegramChat = {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
};

export type TelegramMessage = {
	message_id: number;
	chat: TelegramChat;
	from?: TelegramUser;
	text?: string;
};

export type TelegramCallbackQuery = {
	id: string;
	from: TelegramUser;
	message?: TelegramMessage;
	data?: string;
};

export type TelegramUpdate = {
	update_id: number;
	message?: TelegramMessage;
	callback_query?: TelegramCallbackQuery;
};

export type InlineKeyboardButton = {
	text: string;
	callback_data?: string;
	web_app?: { url: string };
};

export type InlineKeyboardMarkup = {
	inline_keyboard: InlineKeyboardButton[][];
};

type TelegramResponse<T> = {
	ok: boolean;
	result?: T;
	description?: string;
	error_code?: number;
};

export class TelegramError extends Error {
	readonly method: string;
	readonly description: string;
	readonly errorCode: number | undefined;

	constructor(method: string, description: string, errorCode: number | undefined) {
		super(`${method}: ${description}`);
		this.name = 'TelegramError';
		this.method = method;
		this.description = description;
		this.errorCode = errorCode;
	}
}

export class TelegramApi {
	readonly #apiBase: string;
	readonly #token: string;

	constructor(apiBase: string, token: string) {
		this.#apiBase = apiBase.replace(/\/+$/, '');
		this.#token = token;
	}

	async call<T>(
		method: string,
		payload: Record<string, unknown> = {},
		timeoutMs = 15_000
	): Promise<T> {
		const response = await fetch(`${this.#apiBase}/bot${this.#token}/${method}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(timeoutMs)
		});

		const body = (await response.json().catch(() => null)) as TelegramResponse<T> | null;

		if (!response.ok || !body?.ok) {
			throw new TelegramError(
				method,
				body?.description ?? `HTTP ${response.status}`,
				body?.error_code ?? response.status
			);
		}

		return body.result as T;
	}
}
