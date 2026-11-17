export const GROUPS = ['A', 'B', 'C', 'D', 'E'] as const;

export type Group = (typeof GROUPS)[number];

export function isGroup(value: unknown): value is Group {
	return typeof value === 'string' && (GROUPS as readonly string[]).includes(value);
}

/** Where an account stands in the bot's onboarding flow. */
export const ONBOARDING_STAGES = ['awaiting-invite', 'choosing-group', 'ready'] as const;

export type OnboardingStage = (typeof ONBOARDING_STAGES)[number];

export function isOnboardingStage(value: unknown): value is OnboardingStage {
	return typeof value === 'string' && (ONBOARDING_STAGES as readonly string[]).includes(value);
}

/** The six prompts every topic is answered by, in canonical order. */
export const FIELD_KEYS = ['what', 'when', 'where', 'why', 'who', 'how'] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export function isFieldKey(value: unknown): value is FieldKey {
	return typeof value === 'string' && (FIELD_KEYS as readonly string[]).includes(value);
}

/** Which part of the coach a topic belongs to; null when the syllabus is silent. */
export const SIDES = ['left', 'supplementary', 'right'] as const;

export type Side = (typeof SIDES)[number];

export function isSide(value: unknown): value is Side {
	return typeof value === 'string' && (SIDES as readonly string[]).includes(value);
}

/** A graded verdict. Absence of a row means Untouched. */
export const FIELD_STATE_VALUES = ['learned', 'unlearned'] as const;

export type FieldStateValue = (typeof FIELD_STATE_VALUES)[number];

export function isFieldStateValue(value: unknown): value is FieldStateValue {
	return typeof value === 'string' && (FIELD_STATE_VALUES as readonly string[]).includes(value);
}

/** Verdicts for one visit to one topic card, keyed by field. */
export type Verdicts = Partial<Record<FieldKey, FieldStateValue>>;

/** A field as stored: authored text, or marked not applicable, or still empty. */
export type CardFieldInput = {
	key: FieldKey;
	text: string;
	notApplicable: boolean;
};

/** A field as it appears on a learner's card. Only authored, applicable fields. */
export type CardField = {
	key: FieldKey;
	text: string;
};

export type TopicInput = {
	id: number;
	position: number;
	name: string;
	side: Side | null;
	fields: CardFieldInput[];
};

/** One topic rendered as a card. */
export type TopicCard = {
	id: number;
	position: number;
	name: string;
	side: Side | null;
	fields: CardField[];
};

/** One section's cards in route order; empty-card topics are omitted. */
export type SectionRun = {
	section: { number: number; name: string };
	topicCount: number;
	cards: TopicCard[];
};

/** How a run was started: a whole group, its gaps, or one section on its own. */
export const RUN_KINDS = ['learn-new', 'repeat-gaps', 'section'] as const;

export type RunKind = (typeof RUN_KINDS)[number];
export type GroupRunKind = Exclude<RunKind, 'section'>;

export function isGroupRunKind(value: unknown): value is GroupRunKind {
	return value === 'learn-new' || value === 'repeat-gaps';
}

/** One card in a flat run, carrying the section it belongs to. */
export type RunCard = TopicCard & {
	section: { number: number; name: string };
	topicCount: number;
};

/** A flat list of cards across sections, walked as one run. */
export type Run = {
	kind: RunKind;
	cards: RunCard[];
};

export type RunSectionInput = {
	section: { number: number; name: string };
	topics: readonly TopicInput[];
};

/**
 * Keeps authored, applicable fields in canonical What, When, Where, Why, Who,
 * How order. Empty and marked-not-applicable fields are never gradeable.
 */
export function gradeableFields(fields: readonly CardFieldInput[]): CardField[] {
	const gradeable: CardField[] = [];
	for (const key of FIELD_KEYS) {
		const field = fields.find((candidate) => candidate.key === key);
		if (field && !field.notApplicable && field.text.trim() !== '') {
			gradeable.push({ key, text: field.text });
		}
	}
	return gradeable;
}

/** Orders topics by route position and drops any with no gradeable fields. */
export function buildSectionRun(
	section: { number: number; name: string },
	topics: readonly TopicInput[]
): SectionRun {
	const ordered = [...topics].sort((left, right) => left.position - right.position);
	const cards: TopicCard[] = [];

	for (const topic of ordered) {
		const fields = gradeableFields(topic.fields);
		if (fields.length === 0) continue;

		cards.push({
			id: topic.id,
			position: topic.position,
			name: topic.name,
			side: topic.side,
			fields
		});
	}

	return { section, topicCount: ordered.length, cards };
}

/** Lifts a section's cards into the flat shape the run screen walks. */
function sectionRunCards(sectionRun: SectionRun): RunCard[] {
	return sectionRun.cards.map((card) => ({
		...card,
		section: sectionRun.section,
		topicCount: sectionRun.topicCount
	}));
}

/** Lifts a single section's run into the flat shape the run screen walks. */
export function runFromSection(sectionRun: SectionRun): Run {
	return { kind: 'section', cards: sectionRunCards(sectionRun) };
}

/**
 * Flattens sections into one run in section-number and route order. Topics
 * without gradeable fields are omitted, so a run never lands on an empty card.
 */
export function buildRun(kind: RunKind, sections: readonly RunSectionInput[]): Run {
	const ordered = [...sections].sort(
		(left, right) => left.section.number - right.section.number
	);

	return {
		kind,
		cards: ordered.flatMap((input) =>
			sectionRunCards(buildSectionRun(input.section, input.topics))
		)
	};
}

/**
 * The group sections a run walks, in ascending number order. Learn new takes
 * every section; Repeat takes only sections holding at least one Unlearned field.
 */
export function selectedSectionNumbers(
	kind: GroupRunKind,
	sections: readonly { number: number; unlearned: number }[]
): number[] {
	return [...sections]
		.sort((left, right) => left.number - right.number)
		.filter((section) => kind === 'learn-new' || section.unlearned > 0)
		.map((section) => section.number);
}

/**
 * Next and Back over the flat run. Back stays on the first card (the control is
 * disabled there); Next past the last card returns null, meaning the run is
 * exhausted and the learner goes home.
 */
export function stepRun(
	cardCount: number,
	cardIndex: number,
	action: 'next' | 'back'
): number | null {
	if (action === 'back') return cardIndex > 0 ? cardIndex - 1 : 0;
	return cardIndex + 1 < cardCount ? cardIndex + 1 : null;
}

export type LeaveAction = 'write' | 'confirm' | 'advance';

/**
 * The one leaving rule for Next, Back and Exit: a fully graded card is written,
 * a partly graded card asks first, and an untouched card advances silently.
 */
export function leaveAction(fields: readonly CardField[], verdicts: Verdicts): LeaveAction {
	const graded = fields.filter((field) => isFieldStateValue(verdicts[field.key])).length;
	if (graded === 0) return 'advance';
	if (graded === fields.length) return 'write';
	return 'confirm';
}

/** True only when every gradeable field carries a verdict and no others do. */
export function verdictsMatchCard(fields: readonly CardField[], verdicts: Verdicts): boolean {
	if (fields.length === 0) return false;
	if (Object.keys(verdicts).length !== fields.length) return false;

	return fields.every((field) => isFieldStateValue(verdicts[field.key]));
}

/** One section's progress for one account. */
export type SectionProgress = {
	number: number;
	name: string;
	learned: number;
	unlearned: number;
	untouched: number;
};

/** The learner home response: the signed-in account plus its five in-scope sections. */
export type HomeResponse = {
	account: {
		firstName: string;
		group: Group;
	};
	sections: SectionProgress[];
	totalSections: number;
};

/** One row of the full section list, with whether it belongs to the learner's group. */
export type SectionListItem = SectionProgress & {
	inScope: boolean;
};

/** The full 25-section list: every section, in route order, scoped for one account. */
export type SectionListResponse = {
	account: {
		firstName: string;
		group: Group;
	};
	sections: SectionListItem[];
};
