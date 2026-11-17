import type { Side } from '@susanin/shared';
import type { BriefSection } from './brief';
import type { SyllabusItem, SyllabusSection } from './syllabus';
import { nameSimilarity, normalizeName } from './text';

export type PlannedTopic = {
	name: string;
	side: Side | null;
	notApplicable: boolean;
};

export type PlannedSection = {
	number: number;
	name: string;
	topics: PlannedTopic[];
};

export type ImportReport = {
	sectionCount: number;
	briefTopicCount: number;
	syllabusItemCount: number;
	matched: Array<{
		sectionNumber: number;
		briefName: string;
		syllabusName: string;
		side: Side;
	}>;
	unmatched: Array<{ sectionNumber: number; briefName: string }>;
	appended: Array<{ sectionNumber: number; syllabusName: string; side: Side }>;
	ambiguous: Array<{
		sectionNumber: number;
		briefName: string;
		syllabusName: string;
		score: number;
	}>;
};

export type ImportPlan = {
	sections: PlannedSection[];
	report: ImportReport;
};

/** A fuzzy candidate must be this close before the report calls it ambiguous. */
const AMBIGUITY_THRESHOLD = 0.8;

/**
 * Joins the two documents without guessing. Only exact-after-normalisation
 * names receive a side; near matches are reported and the Syllabus item is
 * appended as a not-applicable topic instead.
 */
export function planImport(
	brief: readonly BriefSection[],
	syllabus: readonly SyllabusSection[]
): ImportPlan {
	const briefByNumber = new Map(brief.map((section) => [section.number, section]));
	const syllabusByNumber = new Map(syllabus.map((section) => [section.number, section]));
	const sectionNumbers = [...new Set([...briefByNumber.keys(), ...syllabusByNumber.keys()])].sort(
		(left, right) => left - right
	);

	const report: ImportReport = {
		sectionCount: 0,
		briefTopicCount: 0,
		syllabusItemCount: 0,
		matched: [],
		unmatched: [],
		appended: [],
		ambiguous: []
	};
	const planned: PlannedSection[] = [];

	for (const number of sectionNumbers) {
		const briefSection = briefByNumber.get(number);
		const syllabusSection = syllabusByNumber.get(number);
		const briefNames = briefSection?.topicNames ?? [];
		const items = syllabusSection?.items ?? [];

		report.briefTopicCount += briefNames.length;
		report.syllabusItemCount += items.length;

		const sideByBriefIndex = new Map<number, Side>();
		const matchedItemIndexes = new Set<number>();

		briefNames.forEach((name, briefIndex) => {
			const normalized = normalizeName(name);
			const found = items.findIndex(
				(item, itemIndex) =>
					!matchedItemIndexes.has(itemIndex) && normalizeName(item.name) === normalized
			);
			if (found === -1) return;

			const item = items[found];
			matchedItemIndexes.add(found);
			sideByBriefIndex.set(briefIndex, item.side);
			report.matched.push({
				sectionNumber: number,
				briefName: name,
				syllabusName: item.name,
				side: item.side
			});
		});

		const unmatchedBrief = briefNames
			.map((name, briefIndex) => ({ name, briefIndex }))
			.filter(({ briefIndex }) => !sideByBriefIndex.has(briefIndex));
		const unmatchedItems = items
			.map((item, itemIndex) => ({ item, itemIndex }))
			.filter(({ itemIndex }) => !matchedItemIndexes.has(itemIndex));

		for (const { name } of unmatchedBrief) {
			report.unmatched.push({ sectionNumber: number, briefName: name });
		}

		for (const { item } of unmatchedItems) {
			report.appended.push({ sectionNumber: number, syllabusName: item.name, side: item.side });
		}

		reportAmbiguous(number, unmatchedBrief, unmatchedItems, report);

		const topics: PlannedTopic[] = briefNames.map((name, briefIndex) => ({
			name,
			side: sideByBriefIndex.get(briefIndex) ?? null,
			notApplicable: false
		}));

		for (const { item } of unmatchedItems) {
			topics.push({ name: item.name, side: item.side, notApplicable: true });
		}

		planned.push({
			number,
			name: briefSection?.title ?? syllabusSection?.title ?? `Section ${number}`,
			topics
		});
	}

	report.sectionCount = planned.length;
	return { sections: planned, report };
}

function reportAmbiguous(
	sectionNumber: number,
	unmatchedBrief: Array<{ name: string }>,
	unmatchedItems: Array<{ item: SyllabusItem; itemIndex: number }>,
	report: ImportReport
): void {
	const claimed = new Set<number>();

	for (const { name } of unmatchedBrief) {
		let best: { item: SyllabusItem; itemIndex: number; score: number } | null = null;

		for (const { item, itemIndex } of unmatchedItems) {
			if (claimed.has(itemIndex)) continue;
			const score = nameSimilarity(name, item.name);
			if (score < AMBIGUITY_THRESHOLD) continue;
			if (best && score <= best.score) continue;
			best = { item, itemIndex, score };
		}

		if (!best) continue;
		claimed.add(best.itemIndex);
		report.ambiguous.push({
			sectionNumber,
			briefName: name,
			syllabusName: best.item.name,
			score: best.score
		});
	}
}
