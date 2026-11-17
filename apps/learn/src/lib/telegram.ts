export type TelegramWebApp = {
	ready(): void;
	expand(): void;
	setHeaderColor?(color: string): void;
	setBackgroundColor?(color: string): void;
	initData: string;
};

declare global {
	interface Window {
		Telegram?: {
			WebApp?: TelegramWebApp;
		};
	}
}

/** The Telegram script is loaded in app.html; it is absent in a plain browser. */
export function telegramWebApp(): TelegramWebApp | undefined {
	if (typeof window === 'undefined') return undefined;
	return window.Telegram?.WebApp;
}

export const PAGE_COLOR = '#f1f4ee';

/** Tells Telegram the Mini App is ready and matches its chrome to the page. */
export function initTelegram(): void {
	const telegram = telegramWebApp();
	telegram?.ready();
	telegram?.expand();
	telegram?.setHeaderColor?.(PAGE_COLOR);
	telegram?.setBackgroundColor?.(PAGE_COLOR);
}
