import { and, eq, gte, sql } from 'drizzle-orm';
import { isGroup, type Group, type OnboardingStage } from '@susanin/shared';
import type { ApiConfig } from './config';
import { constantTimeEqual } from './constant-time';
import type { SusaninDatabase } from './db';
import { accounts, inviteAttempts } from './db/schema';

export const FAILED_ATTEMPT_LIMIT = 20;
const FAILED_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;

export type StartResult = {
	stage: OnboardingStage;
	group?: Group;
};

export type InviteResult =
	| { status: 'joined' }
	| { status: 'already-member' }
	| { status: 'invalid' }
	| { status: 'rate-limited' };

export function startOnboarding(
	db: SusaninDatabase,
	config: ApiConfig,
	input: { telegramId: number; firstName: string }
): StartResult {
	const displayName = input.firstName.trim() || 'Learner';
	const isAdmin = config.adminIds.includes(input.telegramId);

	db.update(accounts)
		.set({ displayName, isAdmin })
		.where(eq(accounts.telegramId, input.telegramId))
		.run();

	const account = findAccountByTelegramId(db, input.telegramId);
	if (!account) return { stage: 'awaiting-invite' };
	if (!isGroup(account.groupName)) return { stage: 'choosing-group' };

	return { stage: 'ready', group: account.groupName };
}

export function submitInvite(
	db: SusaninDatabase,
	config: ApiConfig,
	input: { telegramId: number; firstName: string; code: string }
): InviteResult {
	const existing = findAccountByTelegramId(db, input.telegramId);
	if (existing) {
		return { status: 'already-member' };
	}

	const now = config.now();
	const cutoff = now - FAILED_ATTEMPT_WINDOW_MS;

	const failed = db
		.select({ count: sql<number>`count(*)` })
		.from(inviteAttempts)
		.where(
			and(
				eq(inviteAttempts.telegramId, input.telegramId),
				gte(inviteAttempts.attemptedAt, cutoff)
			)
		)
		.get();

	if ((failed?.count ?? 0) >= FAILED_ATTEMPT_LIMIT) {
		return { status: 'rate-limited' };
	}

	if (!constantTimeEqual(input.code, config.inviteCode)) {
		db.insert(inviteAttempts)
			.values({ telegramId: input.telegramId, attemptedAt: now })
			.run();
		return { status: 'invalid' };
	}

	db.transaction((tx) => {
		tx.delete(inviteAttempts)
			.where(eq(inviteAttempts.telegramId, input.telegramId))
			.run();

		tx.insert(accounts)
			.values({
				telegramId: input.telegramId,
				displayName: input.firstName.trim() || 'Learner',
				groupName: null,
				isAdmin: config.adminIds.includes(input.telegramId),
				createdAt: now
			})
			.run();
	});

	return { status: 'joined' };
}

export function chooseGroup(
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

export function findAccountByTelegramId(
	db: SusaninDatabase,
	telegramId: number
): typeof accounts.$inferSelect | undefined {
	return db.select().from(accounts).where(eq(accounts.telegramId, telegramId)).get();
}

export function findAccountById(
	db: SusaninDatabase,
	accountId: number
): typeof accounts.$inferSelect | undefined {
	return db.select().from(accounts).where(eq(accounts.id, accountId)).get();
}
