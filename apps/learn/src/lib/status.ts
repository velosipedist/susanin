import type { SessionStatus } from './api';

export type LoadStatus = SessionStatus | 'ready';

/**
 * One human explanation for every load outcome. A null status means the first
 * request is still in flight, so the caller supplies its own loading prompt.
 */
export function statusMessage(status: LoadStatus | null, loading: string): string {
	if (!status) return loading;

	switch (status) {
		case 'onboarding-required':
			return 'Join the tour with the invite code in the bot, then choose your group.';
		case 'group-required':
			return 'Choose your group in the bot before opening Susanin.';
		case 'signed-out':
			return 'Open Susanin from the Telegram bot to sign in.';
		case 'ready':
		case 'unavailable':
			return 'Susanin is unavailable right now. Try again in a moment.';
	}
}
