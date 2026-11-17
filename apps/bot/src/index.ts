import { GROUPS, isGroup, type Group, type OnboardingStage } from '@susanin/shared';
import { loadConfig, type Config } from './config';
import { SusaninService } from './service';
import {
	TelegramApi,
	TelegramError,
	type InlineKeyboardMarkup,
	type TelegramCallbackQuery,
	type TelegramUpdate,
	type TelegramUser
} from './telegram';

const config = loadConfigOrExit();

const api = new TelegramApi(config.apiBase, config.token);
const service = new SusaninService(config.serviceUrl, config.serviceSecret);

/**
 * Local UI state only: which message the bot should edit in place. Account
 * membership and group live in the API, so a restart never asks a known
 * account for the invite code again.
 */
type ChatState = {
	stage: OnboardingStage;
	group?: Group;
	panelId?: number;
};

const chats = new Map<number, ChatState>();

const welcomeText = `Welcome to Susanin.

Send the invite code you were given to join the tour.`;

const wrongCodeText = 'That invite code is not right. Check it and try again.';

const rateLimitedText =
	'Too many wrong invite codes. Try again in an hour, or ask for the right code.';

const serviceDownText = 'Susanin is unavailable right now. Try again in a moment.';

function stateFor(chatId: number): ChatState {
	let state = chats.get(chatId);
	if (!state) {
		state = { stage: 'awaiting-invite' };
		chats.set(chatId, state);
	}
	return state;
}

function groupKeyboard(current?: Group): InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			GROUPS.map((group) => ({
				text: current === group ? `${group} ✓` : group,
				callback_data: `group:${group}`
			}))
		]
	};
}

function openKeyboard(): InlineKeyboardMarkup {
	return {
		inline_keyboard: [
			[{ text: 'Open Susanin', web_app: { url: config.webAppUrl } }],
			[{ text: 'Change group', callback_data: 'change-group' }]
		]
	};
}

async function sendPanel(
	chatId: number,
	state: ChatState,
	text: string,
	keyboard?: InlineKeyboardMarkup
): Promise<void> {
	if (state.panelId !== undefined) {
		try {
			await api.call('editMessageText', {
				chat_id: chatId,
				message_id: state.panelId,
				text,
				reply_markup: keyboard ?? { inline_keyboard: [] }
			});
			return;
		} catch (error) {
			if (error instanceof TelegramError && /message is not modified/i.test(error.description)) {
				return;
			}
			console.warn(`Could not edit the bot panel in chat ${chatId}; sending a new one.`);
		}
	}

	const sent = await api.call<{ message_id: number }>('sendMessage', {
		chat_id: chatId,
		text,
		reply_markup: keyboard
	});
	state.panelId = sent.message_id;
}

async function sendText(chatId: number, text: string): Promise<void> {
	await api.call('sendMessage', { chat_id: chatId, text });
}

async function showGroupChoice(chatId: number, state: ChatState, intro: string): Promise<void> {
	state.stage = 'choosing-group';
	await sendPanel(
		chatId,
		state,
		`${intro}\n\nPick the group whose five sections you study.`,
		groupKeyboard(state.group)
	);
}

async function showReady(chatId: number, state: ChatState, group: Group): Promise<void> {
	state.stage = 'ready';
	state.group = group;

	await sendPanel(
		chatId,
		state,
		`Group ${group} selected.\n\nTap Open Susanin to start studying.`,
		openKeyboard()
	);
}

async function handleStart(
	chatId: number,
	state: ChatState,
	from: TelegramUser | undefined
): Promise<void> {
	try {
		const result = await service.start({
			telegramId: from?.id ?? chatId,
			firstName: from?.first_name ?? 'Learner'
		});

		if (result.stage === 'ready' && result.group) {
			await showReady(chatId, state, result.group);
			return;
		}

		if (result.stage === 'choosing-group') {
			await showGroupChoice(chatId, state, 'Choose your group.');
			return;
		}

		state.stage = 'awaiting-invite';
		await sendPanel(chatId, state, welcomeText);
	} catch (error) {
		await reportServiceFailure(chatId, error);
	}
}

async function handleMessage(
	chatId: number,
	state: ChatState,
	text: string,
	from: TelegramUser | undefined
): Promise<void> {
	if (isStartCommand(text)) {
		await handleStart(chatId, state, from);
		return;
	}

	switch (state.stage) {
		case 'awaiting-invite':
			try {
				const result = await service.invite({
					telegramId: from?.id ?? chatId,
					firstName: from?.first_name ?? 'Learner',
					code: text
				});

				if (result === 'joined' || result === 'already-member') {
					await showGroupChoice(chatId, state, 'You are in. Choose your group.');
				} else if (result === 'rate-limited') {
					await sendText(chatId, rateLimitedText);
				} else {
					await sendText(chatId, wrongCodeText);
				}
			} catch (error) {
				await reportServiceFailure(chatId, error);
			}
			break;
		case 'choosing-group':
			await sendText(chatId, 'Choose your group with the buttons above.');
			break;
		case 'ready':
			await sendText(chatId, 'Tap Open Susanin above, or send /start.');
			break;
	}
}

async function handleCallback(query: TelegramCallbackQuery): Promise<void> {
	const chatId = query.message?.chat.id;
	if (chatId === undefined) return;

	const data = query.data ?? '';
	const state = stateFor(chatId);

	if (data === 'change-group') {
		await answerCallback(query.id);
		await showGroupChoice(chatId, state, 'Choose a different group.');
		return;
	}

	if (!data.startsWith('group:')) return;

	const group = data.slice('group:'.length);
	if (!isGroup(group)) {
		await answerCallback(query.id, 'Unknown group.');
		return;
	}

	try {
		const known = await service.chooseGroup({
			telegramId: query.from.id,
			group
		});

		if (!known) {
			state.stage = 'awaiting-invite';
			await sendPanel(chatId, state, welcomeText);
			await answerCallback(query.id, 'Send the invite code first.');
			return;
		}

		await answerCallback(query.id, `Group ${group}`);
		await showReady(chatId, state, group);
	} catch (error) {
		await answerCallback(query.id, 'Could not save your group.');
		await reportServiceFailure(chatId, error);
	}
}

async function reportServiceFailure(chatId: number, error: unknown): Promise<void> {
	console.error(`Susanin API call failed: ${describe(error)}`);
	try {
		await sendText(chatId, serviceDownText);
	} catch (sendError) {
		console.error(`Could not tell chat ${chatId} about the failure: ${describe(sendError)}`);
	}
}

async function answerCallback(id: string, text?: string): Promise<void> {
	try {
		await api.call('answerCallbackQuery', {
			callback_query_id: id,
			...(text ? { text } : {})
		});
	} catch (error) {
		console.warn(`Could not answer callback ${id}: ${describe(error)}`);
	}
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
	const message = update.message;
	if (message) {
		if (message.chat.type !== 'private') {
			await sendText(message.chat.id, 'Susanin works in a private chat. Message the bot directly.');
			return;
		}

		const text = message.text?.trim() ?? '';
		if (!text) return;

		await handleMessage(message.chat.id, stateFor(message.chat.id), text, message.from);
		return;
	}

	const callback = update.callback_query;
	if (callback) {
		await handleCallback(callback);
	}
}

function isStartCommand(text: string): boolean {
	return /^\/start(@\w+)?(\s|$)/.test(text);
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function loadConfigOrExit(): Config {
	try {
		return loadConfig();
	} catch (error) {
		console.error(describe(error));
		process.exit(1);
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function poll(): Promise<void> {
	let offset = 0;
	let stopping = false;

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			stopping = true;
			console.log('\nStopping Susanin bot.');
			process.exit(0);
		});
	}

	console.log(`Susanin bot polling ${config.apiBase}`);
	console.log(`Susanin API: ${config.serviceUrl}`);
	console.log(`Mini App URL: ${config.webAppUrl}`);

	while (!stopping) {
		try {
			const updates = await api.call<TelegramUpdate[]>(
				'getUpdates',
				{ offset, timeout: 30, allowed_updates: ['message', 'callback_query'] },
				40_000
			);

			for (const update of updates) {
				offset = Math.max(offset, update.update_id + 1);
				try {
					await handleUpdate(update);
				} catch (error) {
					console.error(`Update ${update.update_id} failed: ${describe(error)}`);
				}
			}
		} catch (error) {
			if (stopping) break;

			if (error instanceof TelegramError && error.errorCode === 409) {
				console.error(
					'Another process is polling this bot token. Stop it, then restart this bot.'
				);
			} else {
				console.error(`Telegram poll failed: ${describe(error)}. Retrying in 3s.`);
			}

			await delay(3_000);
		}
	}
}

await poll();
