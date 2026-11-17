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
