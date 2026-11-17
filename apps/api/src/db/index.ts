import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';

export type SusaninDatabase = BetterSQLite3Database<typeof schema>;

export type DatabaseHandle = {
	db: SusaninDatabase;
	close(): void;
};

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * Opens a SQLite database and applies every committed migration. Tests pass
 * `:memory:` to get a fresh database per test; the server passes a file outside
 * the checkout (ADR 0002).
 */
export function openDatabase(file = ':memory:'): DatabaseHandle {
	const isMemory = file === ':memory:';

	if (!isMemory) {
		mkdirSync(dirname(file), { recursive: true });
	}

	const sqlite = new Database(file);
	sqlite.pragma('foreign_keys = ON');

	if (!isMemory) {
		sqlite.pragma('journal_mode = WAL');
	}

	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder });

	return {
		db,
		close() {
			sqlite.close();
		}
	};
}
