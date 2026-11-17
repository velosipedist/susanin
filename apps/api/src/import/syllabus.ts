import type { Side } from '@susanin/shared';
import { findOrCreateSection, readSectionHeading } from './text';

export type SyllabusItem = {
	name: string;
	side: Side;
};

export type SyllabusSection = {
	number: number;
	title: string;
	items: SyllabusItem[];
};

const COLUMN_SIDES: readonly Side[] = ['left', 'supplementary', 'right'];
const COLUMN_LABEL = /^(passengers?'?\s+(left|right)|supplementary|left|right)$/i;
const SIDE_LABEL = /^(left|supplementary|right)$/i;

/**
 * Reads the Syllabus's extracted text. Each section page keeps its three
 * columns, separated by tabs or pipes, in left / supplementary / right order.
 * A row of `item | side` is also accepted when the extraction flattens columns.
 */
export function parseSyllabus(text: string): SyllabusSection[] {
	const lines = text.split(/\r?\n/);
	const sections = new Map<number, SyllabusSection>();
	let current: SyllabusSection | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const heading = readSectionHeading(trimmed);
		if (heading) {
			current = findOrCreateSection(sections, heading, (number, title) => ({
				number,
				title,
				items: []
			}));
			continue;
		}

		if (!current) continue;
		const section = current;

		const cells = trimmed.split(/\t|\s*\|\s*/).map((cell) => cell.trim());
		if (cells.every((cell) => cell.length === 0)) continue;
		if (isColumnHeader(cells)) continue;

		if (cells.length === 2 && SIDE_LABEL.test(cells[1])) {
			section.items.push({ name: cells[0], side: toSide(cells[1]) });
			continue;
		}

		cells.slice(0, COLUMN_SIDES.length).forEach((name, column) => {
			if (name) section.items.push({ name, side: COLUMN_SIDES[column] });
		});
	}

	return [...sections.values()].sort((left, right) => left.number - right.number);
}

function isColumnHeader(cells: string[]): boolean {
	const labels = cells.filter((cell) => cell.length > 0).map((cell) => cell.replace(/[’']/g, "'"));
	return labels.length > 0 && labels.every((label) => COLUMN_LABEL.test(label));
}

function toSide(value: string): Side {
	if (/^supplementary$/i.test(value)) return 'supplementary';
	if (/^right$/i.test(value)) return 'right';
	return 'left';
}
