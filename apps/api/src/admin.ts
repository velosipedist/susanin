import { eq, sql } from 'drizzle-orm';
import type {
	AdminDashboardResponse,
	AdminSectionStatus
} from '@susanin/shared';
import type { ApiConfig } from './config';
import type { SusaninDatabase } from './db';
import { sections, topicFields, topics } from './db/schema';

/**
 * Admin rights are granted by `ADMIN_IDS` or by the stored in-app flag. Both
 * are checked on every request so a hidden screen is never the control.
 */
export function isAdminAccount(
	account: { telegramId: number; isAdmin: boolean },
	config: ApiConfig
): boolean {
	return account.isAdmin || config.adminIds.includes(account.telegramId);
}

export function loadDashboard(db: SusaninDatabase): AdminDashboardResponse {
	const rows = db
		.select({
			number: sections.number,
			name: sections.name,
			topicCount: sql<number>`count(distinct ${topics.id})`,
			authoredFields: sql<number>`coalesce(sum(case when ${topicFields.notApplicable} = 0 and ${topicFields.text} <> '' then 1 else 0 end), 0)`,
			notApplicableFields: sql<number>`coalesce(sum(case when ${topicFields.notApplicable} = 1 then 1 else 0 end), 0)`,
			emptyFields: sql<number>`coalesce(sum(case when ${topicFields.notApplicable} = 0 and ${topicFields.text} = '' then 1 else 0 end), 0)`
		})
		.from(sections)
		.leftJoin(topics, eq(topics.sectionNumber, sections.number))
		.leftJoin(topicFields, eq(topicFields.topicId, topics.id))
		.groupBy(sections.number, sections.name)
		.orderBy(sections.number)
		.all();

	const summaries = rows.map((row) => ({ ...row, status: statusFor(row) }));

	return {
		sections: summaries,
		totalSections: summaries.length
	};
}

function statusFor(row: {
	authoredFields: number;
	emptyFields: number;
}): AdminSectionStatus {
	if (row.authoredFields === 0) return 'empty';
	if (row.emptyFields === 0) return 'complete';
	return 'partial';
}
