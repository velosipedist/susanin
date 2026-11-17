import { timingSafeEqual } from 'node:crypto';
import { GROUPS, isGroup, type Group } from '@susanin/shared';
import { loadConfig, type Config } from './config';
import {
	TelegramApi,
	TelegramError,
	type InlineKeyboardMarkup,
	type TelegramCallbackQuery,
	type TelegramUpdate
} from './telegram';

const config = loadConfigOrExit();

const api = new TelegramApi(config.apiBase, config.token);

type Stage = 'awaiting-invite' | 'choosing-group' | 'ready';

type ChatState = {
	stage: Stage;
	group?: Group;
	/** The one message whose buttons the bot edits in place. */
	panelId?: number;
};

/**
 * The demo keeps every account in memory. Restarting the process forgets
 * verified accounts and chosen groups, as intended until issue #3 adds SQLite.
 */
const chats = new Map<number, ChatState>();

const welcomeText = `Welcome to Susanin.

Send the invite code you were given to join the tour.`;

const wrongCodeText = 'That invite code is not right. Check it and try again.';

function stateFor(chatId: number): ChatState {
	let state = chats.get(chatId);
	if (!state) {
		state = { stage: 'awaiting-invite' };
		chats.set(chatId, state);
	}
	return state;
}

function matchesInvite(candidate: string): boolean {
	const given = Buffer.from(candidate);
	const expected = Buffer.from(config.inviteCode);
	if (given.length !== expected.length) return false;
	return timingSafeEqual(given, expected);
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

function openKeyboard(group: Group): InlineKeyboardMarkup {
	const url = new URL(config.webAppUrl);
	url.searchParams.set('group', group);

	return {
		inline_keyboard: [
			[{ text: 'Open Susanin', web_app: { url: url.toString() } }],
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
		openKeyboard(group)
	);
}

async function handleStart(chatId: number, state: ChatState): Promise<void> {
	if (state.stage === 'ready' && state.group) {
		await showReady(chatId, state, state.group);
		return;
	}

	if (state.stage === 'choosing-group') {
		await showGroupChoice(chatId, state, 'Choose your group.');
		return;
	}

	state.stage = 'awaiting-invite';
	await sendPanel(chatId, state, welcomeText);
}

async function handleMessage(chatId: number, state: ChatState, text: string): Promise<void> {
	if (isStartCommand(text)) {
		await handleStart(chatId, state);
		return;
	}

	switch (state.stage) {
		case 'awaiting-invite':
			if (matchesInvite(text)) {
				await showGroupChoice(chatId, state, 'You are in. Choose your group.');
			} else {
				await sendText(chatId, wrongCodeText);
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

	if (data === 'change-group') {
		await answerCallback(query.id);
		await showGroupChoice(chatId, stateFor(chatId), 'Choose a different group.');
		return;
	}

	if (!data.startsWith('group:')) return;

	const group = data.slice('group:'.length);
	if (!isGroup(group)) {
		await answerCallback(query.id, 'Unknown group.');
		return;
	}

	await answerCallback(query.id, `Group ${group}`);
	await showReady(chatId, stateFor(chatId), group);
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

		await handleMessage(message.chat.id, stateFor(message.chat.id), text);
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
