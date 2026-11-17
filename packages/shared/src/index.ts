export const GROUPS = ['A', 'B', 'C', 'D', 'E'] as const;

export type Group = (typeof GROUPS)[number];

export function isGroup(value: unknown): value is Group {
	return typeof value === 'string' && (GROUPS as readonly string[]).includes(value);
}
