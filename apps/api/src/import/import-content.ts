import { eq, sql } from 'drizzle-orm';
import type { SusaninDatabase } from '../db';
import { fieldStates, sections, topicFields, topics } from '../db/schema';
import { parseBrief } from './brief';
import { planImport, type ImportReport } from './plan';
import { parseSyllabus } from './syllabus';

export class ImportBlockedError extends Error {
	readonly fieldStateCount: number;

	constructor(fieldStateCount: number) {
		super(
			`Refusing to import: ${fieldStateCount} field state(s) exist. ` +
				'Run again with --reset to delete the content and every learner verdict first.'
		);
		this.name = 'ImportBlockedError';
		this.fieldStateCount = fieldStateCount;
	}
}

export function countFieldStates(db: SusaninDatabase): number {
	const row = db.select({ count: sql<number>`count(*)` }).from(fieldStates).get();
	return row?.count ?? 0;
}

/**
 * Rebuilds the content tables from the two extracted texts. The Brief owns the
 * order and the syllabus supplies sides; Syllabus-only items are appended with
 * all six fields marked not applicable. Group assignments are left untouched.
 */
export function importContent(input: {
	db: SusaninDatabase;
	briefText: string;
	syllabusText: string;
	reset: boolean;
}): ImportReport {
	const plan = planImport(parseBrief(input.briefText), parseSyllabus(input.syllabusText));

	const existingStates = countFieldStates(input.db);
	if (existingStates > 0 && !input.reset) {
		throw new ImportBlockedError(existingStates);
	}

	input.db.transaction((tx) => {
		if (input.reset) {
			tx.delete(fieldStates).run();
		}

		// Deleting topics cascades to their six fields and to every verdict.
		tx.delete(topics).run();

		for (const section of plan.sections) {
			tx.insert(sections)
				.values({ number: section.number, name: section.name })
				.onConflictDoUpdate({
					target: sections.number,
					set: { name: section.name }
				})
				.run();

			section.topics.forEach((topic, index) => {
				const inserted = tx
					.insert(topics)
					.values({
						sectionNumber: section.number,
						position: index + 1,
						name: topic.name,
						side: topic.side
					})
					.returning({ id: topics.id })
					.get();

				if (!inserted) {
					throw new Error(`Could not insert ${section.name}: ${topic.name}.`);
				}

				tx.update(topicFields)
					.set({ text: '', notApplicable: topic.notApplicable })
					.where(eq(topicFields.topicId, inserted.id))
					.run();
			});
		}
	});

	return plan.report;
}
