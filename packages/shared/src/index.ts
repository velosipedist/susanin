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

/** Which part of the coach a topic belongs to; null when the syllabus is silent. */
export const SIDES = ['left', 'supplementary', 'right'] as const;

export type Side = (typeof SIDES)[number];

export function isSide(value: unknown): value is Side {
	return typeof value === 'string' && (SIDES as readonly string[]).includes(value);
}

/** A graded verdict. Absence of a row means Untouched. */
export type FieldStateValue = 'learned' | 'unlearned';

export function isFieldStateValue(value: unknown): value is FieldStateValue {
	return value === 'learned' || value === 'unlearned';
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

/**
 * Keeps authored, applicable fields in canonical What, When, Where, Why, Who,
 * How order. Empty and marked-not-applicable fields are never gradeable.
 */
export function gradeableFields(fields: readonly CardFieldInput[]): CardField[] {
	return FIELD_KEYS.flatMap((key) => {
		const field = fields.find((candidate) => candidate.key === key);
		if (!field || field.notApplicable || field.text.trim() === '') return [];
		return [{ key, text: field.text }];
	});
}

/** Orders topics by route position and drops any with no gradeable fields. */
export function buildSectionRun(
	section: { number: number; name: string },
	topics: readonly TopicInput[]
): SectionRun {
	const ordered = [...topics].sort((left, right) => left.position - right.position);
	const cards = ordered.flatMap((topic) => {
		const fields = gradeableFields(topic.fields);
		if (fields.length === 0) return [];
		return [
			{
				id: topic.id,
				position: topic.position,
				name: topic.name,
				side: topic.side,
				fields
			}
		];
	});

	return { section, topicCount: ordered.length, cards };
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

	const allowed = new Set<FieldKey>(fields.map((field) => field.key));
	const keys = Object.keys(verdicts);
	if (keys.length !== fields.length) return false;

	return keys.every(
		(key) => allowed.has(key as FieldKey) && isFieldStateValue(verdicts[key as FieldKey])
	);
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
