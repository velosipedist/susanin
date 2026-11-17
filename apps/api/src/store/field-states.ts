import { and, eq } from 'drizzle-orm';
import type { FieldKey, FieldStateValue } from '@susanin/shared';
import type { SusaninDatabase } from '../db';
import { fieldStates } from '../db/schema';

export type TopicFieldStates = Partial<Record<FieldKey, FieldStateValue>>;

/**
 * Replaces one topic's verdicts for one account in a single transaction.
 * A partial card is never persisted by the card flow; this function is the
 * single write seam for a whole topic.
 */
export function writeTopicFieldStates(
	db: SusaninDatabase,
	input: {
		accountId: number;
		topicId: number;
		gradedAt: number;
		states: TopicFieldStates;
	}
): void {
	const rows = Object.entries(input.states).map(([fieldKey, value]) => ({
		accountId: input.accountId,
		topicId: input.topicId,
		fieldKey: fieldKey as FieldKey,
		value: value as FieldStateValue,
		gradedAt: input.gradedAt
	}));

	db.transaction((tx) => {
		tx.delete(fieldStates)
			.where(
				and(
					eq(fieldStates.accountId, input.accountId),
					eq(fieldStates.topicId, input.topicId)
				)
			)
			.run();

		if (rows.length > 0) {
			tx.insert(fieldStates).values(rows).run();
		}
	});
}
