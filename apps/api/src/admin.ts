import { eq, sql } from 'drizzle-orm';
import {
	GROUPS,
	isGroup,
	type AdminCohortResponse,
	type AdminDashboardResponse,
	type AdminPeopleResponse,
	type AdminSectionStatus,
	type Group
} from '@susanin/shared';
import type { ApiConfig } from './config';
import type { SusaninDatabase } from './db';
import { accounts, fieldStates, groupSections, sections, topicFields, topics } from './db/schema';

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

/** Every section and its optional group, with the count for each of A–E. */
export function loadCohort(db: SusaninDatabase): AdminCohortResponse {
	const assignments = db
		.select({
			sectionNumber: groupSections.sectionNumber,
			groupName: groupSections.groupName
		})
		.from(groupSections)
		.all();

	const groupBySection = new Map<number, Group>();
	const counts = new Map<Group, number>(GROUPS.map((group) => [group, 0]));

	for (const assignment of assignments) {
		if (!isGroup(assignment.groupName)) continue;
		groupBySection.set(assignment.sectionNumber, assignment.groupName);
		counts.set(assignment.groupName, (counts.get(assignment.groupName) ?? 0) + 1);
	}

	const sectionRows = db
		.select({ number: sections.number, name: sections.name })
		.from(sections)
		.orderBy(sections.number)
		.all();

	return {
		groups: GROUPS.map((group) => ({ group, sectionCount: counts.get(group) ?? 0 })),
		sections: sectionRows.map((section) => ({
			...section,
			group: groupBySection.get(section.number) ?? null
		}))
	};
}

/**
 * Moves a section to one group, or clears its group. The delete and insert run
 * together so the unique section constraint can never see a half-applied move.
 */
export function assignSectionGroup(
	db: SusaninDatabase,
	input: { sectionNumber: number; group: Group | null }
): boolean {
	const section = db
		.select({ number: sections.number })
		.from(sections)
		.where(eq(sections.number, input.sectionNumber))
		.get();
	if (!section) return false;

	db.transaction((tx) => {
		tx.delete(groupSections).where(eq(groupSections.sectionNumber, input.sectionNumber)).run();

		if (input.group) {
			tx.insert(groupSections)
				.values({ groupName: input.group, sectionNumber: input.sectionNumber })
				.run();
		}
	});

	return true;
}

/**
 * Every account with its group and the number of sections it has touched. A
 * section counts as touched when the account has at least one field state in it.
 */
export function loadPeople(db: SusaninDatabase, config: ApiConfig): AdminPeopleResponse {
	const rows = db
		.select({
			telegramId: accounts.telegramId,
			displayName: accounts.displayName,
			groupName: accounts.groupName,
			isAdmin: accounts.isAdmin,
			touchedSections: sql<number>`count(distinct ${topics.sectionNumber})`
		})
		.from(accounts)
		.leftJoin(fieldStates, eq(fieldStates.accountId, accounts.id))
		.leftJoin(topics, eq(topics.id, fieldStates.topicId))
		.groupBy(accounts.id)
		.orderBy(accounts.displayName, accounts.telegramId)
		.all();

	return {
		people: rows.map((row) => ({
			telegramId: row.telegramId,
			displayName: row.displayName,
			group: isGroup(row.groupName) ? row.groupName : null,
			touchedSections: row.touchedSections,
			isAdmin: row.isAdmin || config.adminIds.includes(row.telegramId)
		}))
	};
}

/** Changes a learner's scope by moving the account; no field state is touched. */
export function moveAccountGroup(
	db: SusaninDatabase,
	input: { telegramId: number; group: Group }
): boolean {
	const result = db
		.update(accounts)
		.set({ groupName: input.group })
		.where(eq(accounts.telegramId, input.telegramId))
		.run();
	return result.changes > 0;
}

/**
 * Grants or revokes the stored admin flag. `ADMIN_IDS` is checked separately on
 * every request, so revoking here cannot remove an environment grant.
 */
export function setAccountAdmin(
	db: SusaninDatabase,
	input: { telegramId: number; isAdmin: boolean }
): boolean {
	const result = db
		.update(accounts)
		.set({ isAdmin: input.isAdmin })
		.where(eq(accounts.telegramId, input.telegramId))
		.run();
	return result.changes > 0;
}
