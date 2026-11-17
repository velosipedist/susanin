import type { SectionProgress } from '@susanin/shared';

export type SectionStats = SectionProgress & {
	authored: number;
	percent: number;
};

export type OverallStats = {
	learned: number;
	authored: number;
	unlearned: number;
	percent: number;
	gapSections: number;
};

/** A field counts once it is authored; marked-not-applicable fields never arrive. */
export function authoredCount(section: SectionProgress): number {
	return section.learned + section.unlearned + section.untouched;
}

export function percentLearned(learned: number, authored: number): number {
	if (authored === 0) return 0;
	return Math.round((learned / authored) * 100);
}

export function sectionStats(section: SectionProgress): SectionStats {
	const authored = authoredCount(section);
	return {
		...section,
		authored,
		percent: percentLearned(section.learned, authored)
	};
}

export function overallStats(sections: SectionProgress[]): OverallStats {
	const learned = sections.reduce((sum, section) => sum + section.learned, 0);
	const authored = sections.reduce((sum, section) => sum + authoredCount(section), 0);
	const unlearned = sections.reduce((sum, section) => sum + section.unlearned, 0);
	const gapSections = sections.filter((section) => section.unlearned > 0).length;

	return {
		learned,
		authored,
		unlearned,
		percent: percentLearned(learned, authored),
		gapSections
	};
}
