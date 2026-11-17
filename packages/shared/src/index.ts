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

/** An account as the admin app sees it. Admin rights may be granted by env or in-app. */
export type AdminAccount = {
	telegramId: number;
	displayName: string;
	group: Group | null;
	isAdmin: boolean;
};

export type AdminSessionResponse = {
	account: AdminAccount;
};

/**
 * A section is `empty` when it has no authored field at all, `complete` when
 * every field is either authored or marked not applicable, and `partial`
 * otherwise.
 */
export type AdminSectionStatus = 'empty' | 'partial' | 'complete';

export type AdminSectionSummary = {
	number: number;
	name: string;
	topicCount: number;
	authoredFields: number;
	notApplicableFields: number;
	emptyFields: number;
	status: AdminSectionStatus;
};

export type AdminDashboardResponse = {
	sections: AdminSectionSummary[];
	totalSections: number;
};
