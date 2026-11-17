import {
	findOrCreateSection,
	isBackMatterHeading,
	isTopicHeading,
	readSectionHeading
} from './text';

export type BriefSection = {
	number: number;
	title: string;
	topicNames: string[];
};

/**
 * Reads the Brief's extracted text: `Section NN – Title` starts a section and
 * every isolated heading line below it is a topic. Anything before the first
 * section or after back matter is ignored.
 */
export function parseBrief(text: string): BriefSection[] {
	const lines = text.split(/\r?\n/);
	const sections = new Map<number, BriefSection>();
	let current: BriefSection | null = null;

	for (const [index, line] of lines.entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const heading = readSectionHeading(trimmed);
		if (heading) {
			current = findOrCreateSection(sections, heading, (number, title) => ({
				number,
				title,
				topicNames: []
			}));
			continue;
		}

		if (isBackMatterHeading(trimmed)) {
			current = null;
			continue;
		}

		if (current && isTopicHeading(trimmed, index, lines)) {
			current.topicNames.push(trimmed);
		}
	}

	return [...sections.values()].sort((left, right) => left.number - right.number);
}
