export type Config = {
	/** BotFather token; also used by a local Bot API server. */
	token: string;
	/** Root of the Telegram Bot API, e.g. http://localhost:8081 or https://api.telegram.org. */
	apiBase: string;
	/** Root of the Susanin API that owns accounts, groups and content. */
	serviceUrl: string;
	/** Shared secret the bot presents to the Susanin API's internal routes. */
	serviceSecret: string;
	/** Mini App URL. */
	webAppUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const token = required(env, 'TELEGRAM_BOT_TOKEN');
	const serviceSecret = required(env, 'BOT_API_SECRET');
	const webAppUrl = required(env, 'WEBAPP_URL');

	let parsed: URL;
	try {
		parsed = new URL(webAppUrl);
	} catch {
		throw new Error('WEBAPP_URL must be a valid absolute URL, for example http://localhost:5173/learn/');
	}

	if (parsed.protocol !== 'https:') {
		console.warn(
			'WEBAPP_URL is not HTTPS. Telegram requires HTTPS for Mini App buttons; use a tunnel when opening from a phone. A browser can still open this URL directly.'
		);
	}

	return {
		token,
		apiBase: (env.TELEGRAM_API_BASE?.trim() || 'http://localhost:8081').replace(/\/+$/, ''),
		serviceUrl: (env.API_URL?.trim() || 'http://localhost:3000').replace(/\/+$/, ''),
		serviceSecret,
		webAppUrl: parsed.toString()
	};
}

function required(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (!value) {
		throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
	}
	return value;
}
