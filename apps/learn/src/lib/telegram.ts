export type TelegramWebApp = {
	ready(): void;
	expand(): void;
	setHeaderColor?(color: string): void;
	setBackgroundColor?(color: string): void;
	initDataUnsafe?: {
		user?: {
			first_name?: string;
		};
	};
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

/** The learner's Telegram first name, or null outside Telegram. */
export function telegramFirstName(): string | null {
	const name = telegramWebApp()?.initDataUnsafe?.user?.first_name?.trim();
	return name || null;
}
