export type SectionHeading = {
	number: number;
	title: string | null;
};

const SECTION_HEADING = /^section\s+(\d{1,2})\s*(?:[–—−-]\s*(.+))?$/i;

const BACK_MATTER =
	/^(introduction|background|appendix|appendices|bibliography|glossary|index|references|further reading|sources)\b/i;

/**
 * Recognises `Section NN – Title` and the looser `Section NN` form used by the
 * Syllabus pages. The caller decides whether the number is in range.
 */
export function readSectionHeading(line: string): SectionHeading | null {
	const trimmed = line.trim();
	if (!trimmed || trimmed.length > 120) return null;

	const match = SECTION_HEADING.exec(trimmed);
	if (!match) return null;

	const number = Number(match[1]);
	if (!Number.isInteger(number)) return null;

	const title = match[2]?.replace(/\s+/g, ' ').trim();
	return { number, title: title || null };
}

/** True for headings that end the content and must not become topics. */
export function isBackMatterHeading(line: string): boolean {
	return BACK_MATTER.test(line.trim());
}

/**
 * Opens the section a heading names, reusing the stored section when a later
 * page repeats its number. Returns null for a heading outside the tour's range.
 */
export function findOrCreateSection<T extends { title: string }>(
	sections: Map<number, T>,
	heading: SectionHeading,
	create: (number: number, title: string) => T
): T | null {
	if (heading.number < 1 || heading.number > 25) return null;

	const existing = sections.get(heading.number);
	if (existing) {
		if (heading.title) existing.title = heading.title;
		return existing;
	}

	const section = create(heading.number, heading.title ?? `Section ${heading.number}`);
	sections.set(heading.number, section);
	return section;
}

/**
 * Extracted text keeps every heading on its own line between blank lines; prose
 * wraps into longer lines that end with punctuation. This predicate is the
 * single place that turns that convention into a heading decision.
 */
export function isTopicHeading(
	text: string,
	lineIndex: number,
	lines: readonly string[]
): boolean {
	const trimmed = text.trim();
	if (!trimmed || trimmed.length > 80) return false;
	if (readSectionHeading(trimmed) || isBackMatterHeading(trimmed)) return false;
	if (/[.,;:]$/.test(trimmed)) return false;
	if (/^\d+$/.test(trimmed)) return false;
	if (/^page\s+\d+/i.test(trimmed)) return false;
	if (/^(page\s+)?[ivxlcdm]+$/i.test(trimmed)) return false;
	if (!/^[\p{Lu}\p{N}"“'‘(\[]/u.test(trimmed)) return false;

	const previousIsBlank = lineIndex === 0 || lines[lineIndex - 1].trim() === '';
	const nextIsBlank = lineIndex === lines.length - 1 || lines[lineIndex + 1].trim() === '';
	return previousIsBlank && nextIsBlank;
}

/**
 * Matching key for a Brief heading and a Syllabus item: case, punctuation,
 * diacritics and simple plural forms are all ignored.
 */
export function normalizeName(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/['’`]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(' ')
		.filter((word) => word.length > 0)
		.map(singularize)
		.join(' ');
}

export function nameSimilarity(left: string, right: string): number {
	const a = normalizeName(left);
	const b = normalizeName(right);
	if (!a || !b) return 0;

	const distance = levenshtein(a, b);
	return 1 - distance / Math.max(a.length, b.length);
}

function singularize(word: string): string {
	if (word.length <= 3) return word;
	if (word.endsWith('ies') && word.length > 4) return `${word.slice(0, -3)}y`;
	if (/(ses|xes|zes|ches|shes)$/.test(word)) return word.slice(0, -2);
	if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
	return word;
}

function levenshtein(left: string, right: string): number {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

	for (let row = 1; row <= left.length; row += 1) {
		let diagonal = previous[0];
		previous[0] = row;

		for (let column = 1; column <= right.length; column += 1) {
			const above = previous[column];
			const cost = left[row - 1] === right[column - 1] ? 0 : 1;
			previous[column] = Math.min(previous[column] + 1, previous[column - 1] + 1, diagonal + cost);
			diagonal = above;
		}
	}

	return previous[right.length];
}
