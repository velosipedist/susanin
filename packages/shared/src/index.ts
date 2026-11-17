export const GROUPS = ['A', 'B', 'C', 'D', 'E'] as const;

export type Group = (typeof GROUPS)[number];

export function isGroup(value: unknown): value is Group {
	return typeof value === 'string' && (GROUPS as readonly string[]).includes(value);
}

/** The six prompts every topic is answered by, in canonical order. */
export const FIELD_KEYS = ['what', 'when', 'where', 'why', 'who', 'how'] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

/** Which part of the coach a topic belongs to; null when the syllabus is silent. */
export const SIDES = ['left', 'supplementary', 'right'] as const;

export type Side = (typeof SIDES)[number];

/** A graded verdict. Absence of a row means Untouched. */
export type FieldStateValue = 'learned' | 'unlearned';

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
