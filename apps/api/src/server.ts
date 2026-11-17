import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig, type ApiConfig } from './config';
import { openDatabase } from './db';
import { seedContent, seedDemoAccount } from './db/seed';

const config = loadConfigOrExit();
const { db, close } = openDatabase(config.databaseFile);

seedContent(db);

if (config.devAuth) {
	seedDemoAccount(db, {
		telegramId: config.devTelegramId,
		displayName: config.devDisplayName,
		group: 'B',
		now: config.now()
	});
}

const app = createApp({ db, config });

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
	console.log(`Susanin API listening on http://localhost:${info.port}`);
	console.log(`Database: ${config.databaseFile}`);
	if (config.devAuth) {
		console.log(`DEV_AUTH is on; the browser demo signs in as Telegram id ${config.devTelegramId}.`);
	}
});

function shutdown(): void {
	server.close();
	close();
	process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function loadConfigOrExit(): ApiConfig {
	try {
		return loadConfig();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exit(1);
	}
}
