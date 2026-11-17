import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db';
import { ImportBlockedError, importContent } from './import-content';
import { formatReport } from './report';

const DEFAULT_BRIEF = fileURLToPath(new URL('../../../../_local/brief.txt', import.meta.url));
const DEFAULT_SYLLABUS = fileURLToPath(new URL('../../../../_local/syllabus.txt', import.meta.url));
const DEFAULT_DATABASE = process.env.DATABASE_FILE?.trim() || './data/susanin.db';

type CliOptions = {
	briefPath: string;
	syllabusPath: string;
	databaseFile: string;
	reset: boolean;
};

const USAGE = `Usage: pnpm --filter @susanin/api import:content [options]

Options:
  --brief <path>     Extracted Brief text (default: _local/brief.txt)
  --syllabus <path>  Extracted Syllabus text (default: _local/syllabus.txt)
  --db <path>        SQLite file (default: DATABASE_FILE or ./data/susanin.db)
  --reset            Delete content and every field state before importing
  --help             Show this message

The input text is never committed: extract the PDFs into _local/ locally.`;

function main(argv: string[]): void {
	let options: CliOptions;
	try {
		options = parseArgs(argv);
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		console.error('');
		console.error(USAGE);
		process.exitCode = 1;
		return;
	}

	const briefText = readInput(options.briefPath, 'Brief');
	const syllabusText = readInput(options.syllabusPath, 'Syllabus');
	if (briefText === null || syllabusText === null) {
		process.exitCode = 1;
		return;
	}

	const { db, close } = openDatabase(options.databaseFile);
	try {
		const report = importContent({ db, briefText, syllabusText, reset: options.reset });
		console.log(formatReport(report));
	} catch (error) {
		if (error instanceof ImportBlockedError) {
			console.error(error.message);
			process.exitCode = 1;
			return;
		}
		throw error;
	} finally {
		close();
	}
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		briefPath: DEFAULT_BRIEF,
		syllabusPath: DEFAULT_SYLLABUS,
		databaseFile: DEFAULT_DATABASE,
		reset: false
	};

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];

		switch (argument) {
			case '--brief':
				options.briefPath = nextValue(argv, ++index, '--brief');
				break;
			case '--syllabus':
				options.syllabusPath = nextValue(argv, ++index, '--syllabus');
				break;
			case '--db':
				options.databaseFile = nextValue(argv, ++index, '--db');
				break;
			case '--reset':
				options.reset = true;
				break;
			case '--help':
				console.log(USAGE);
				process.exit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${argument}`);
		}
	}

	return options;
}

function nextValue(argv: string[], index: number, flag: string): string {
	const value = argv[index];
	if (!value || value.startsWith('--')) {
		throw new Error(`${flag} needs a path.`);
	}
	return value;
}

function readInput(path: string, label: string): string | null {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		console.error(`Could not read the ${label} text at ${path}.`);
		return null;
	}
}

main(process.argv.slice(2));
