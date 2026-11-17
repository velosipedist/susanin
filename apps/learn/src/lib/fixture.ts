import type { Group } from '@susanin/shared';

/** One section's authored progress, as the future API will report it. */
export type SectionProgress = {
	number: number;
	name: string;
	learned: number;
	unlearned: number;
	untouched: number;
};

/**
 * The shape of the learner home response. Issue #3 replaces
 * `homeFixture` with `GET /api/home` backed by SQLite.
 */
export type HomeData = {
	account: {
		firstName: string;
		group: Group;
	};
	sections: SectionProgress[];
	totalSections: number;
};

type SectionFixture = {
	number: number;
	name: string;
	counts: [learned: number, unlearned: number, untouched: number];
};

/**
 * Placeholder content until the Brief/Syllabus importer (issue #8) fills the
 * database. Only the names are shown here; no source text is copied.
 */
const SECTIONS: SectionFixture[] = [
	{ number: 1, name: 'Victoria Harbour', counts: [8, 1, 1] },
	{ number: 2, name: 'Star Ferry', counts: [6, 2, 2] },
	{ number: 3, name: "Queen's Pier", counts: [10, 0, 0] },
	{ number: 4, name: 'Convention Centre', counts: [3, 0, 7] },
	{ number: 5, name: 'Golden Bauhinia Square', counts: [0, 1, 9] },
	{ number: 6, name: 'Noonday Gun', counts: [7, 1, 2] },
	{ number: 7, name: 'Victoria Park', counts: [10, 0, 0] },
	{ number: 8, name: 'Tin Hau Temple', counts: [4, 3, 3] },
	{ number: 9, name: 'Jardine House', counts: [0, 2, 8] },
	{ number: 10, name: 'The Peak Tram', counts: [5, 0, 5] },
	{ number: 11, name: 'Peak Tower', counts: [9, 0, 1] },
	{ number: 12, name: 'Repulse Bay', counts: [2, 1, 7] },
	{ number: 13, name: 'Stanley Market', counts: [6, 4, 0] },
	{ number: 14, name: 'Murray House', counts: [0, 0, 10] },
	{ number: 15, name: 'Aberdeen Harbour', counts: [8, 2, 0] },
	{ number: 16, name: 'Ocean Park', counts: [1, 0, 9] },
	{ number: 17, name: 'Central District', counts: [7, 3, 0] },
	{ number: 18, name: 'Statue Square', counts: [5, 5, 0] },
	{ number: 19, name: 'The Cenotaph', counts: [10, 0, 0] },
	{ number: 20, name: 'Hong Kong Park', counts: [3, 2, 5] },
	{ number: 21, name: 'Bank of China Tower', counts: [0, 1, 9] },
	{ number: 22, name: 'Cheung Kong Centre', counts: [4, 0, 6] },
	{ number: 23, name: 'Lan Kwai Fong', counts: [9, 1, 0] },
	{ number: 24, name: 'Man Mo Temple', counts: [6, 2, 2] },
	{ number: 25, name: 'Happy Valley Racecourse', counts: [2, 0, 8] }
];

/** Temporary A–E mapping until admins assign sections (issue #9). */
export const GROUP_SECTIONS: Record<Group, number[]> = {
	A: [1, 2, 3, 4, 5],
	B: [6, 7, 8, 9, 10],
	C: [11, 12, 13, 14, 15],
	D: [16, 17, 18, 19, 20],
	E: [21, 22, 23, 24, 25]
};

export function homeFixture(group: Group, firstName: string): HomeData {
	const inScope = new Set(GROUP_SECTIONS[group]);
	const sections = SECTIONS.filter((section) => inScope.has(section.number)).map(
		({ number, name, counts: [learned, unlearned, untouched] }) => ({
			number,
			name,
			learned,
			unlearned,
			untouched
		})
	);

	return {
		account: { firstName, group },
		sections,
		totalSections: SECTIONS.length
	};
}
