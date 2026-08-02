/**
 * Failed-attempt lockout with exponential backoff — 00 T-5 (FR-4, AC-4).
 *
 * FR-4 has two halves and both matter:
 *   1. reaching `SecuritySettings.lockoutThreshold` applies backoff/lockout;
 *   2. the error is IDENTICAL whether or not the email exists.
 * Half 2 is handled at the boundary (ErrorCode.ACCOUNT_LOCKED and
 * INVALID_CREDENTIALS share one user-facing message in lib/errors.ts, and
 * verifyCredentials spends bcrypt time on unknown emails).
 *
 * The backoff curve is pure and clock-injected so it can be tested without
 * waiting real minutes.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** First lock duration once the threshold is hit. */
export const BASE_LOCKOUT_MINUTES = 1;

/** Cap so an account is never bricked by an attacker hammering it. */
export const MAX_LOCKOUT_MINUTES = 60;

/**
 * Exponential backoff: each failure at or beyond the threshold doubles the
 * wait — 1, 2, 4, 8… minutes, capped.
 *
 * Returns 0 while the count is below the threshold, so early typos cost the
 * user nothing.
 */
export function lockoutMinutesFor(failedCount: number, threshold: number): number {
  if (failedCount < threshold) return 0;
  const overshoot = failedCount - threshold; // 0 on the first lock
  const minutes = BASE_LOCKOUT_MINUTES * 2 ** overshoot;
  return Math.min(minutes, MAX_LOCKOUT_MINUTES);
}

export function isLocked(
  lockedUntil: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now.getTime();
}

export async function getLockoutThreshold(db: Db, orgId: string): Promise<number> {
  const settings = await db.securitySettings.findUnique({
    where: { orgId },
    select: { lockoutThreshold: true },
  });
  return settings?.lockoutThreshold ?? 5;
}

export type FailureRecord = {
  failedLoginCount: number;
  lockedUntil: Date | null;
  locked: boolean;
};

/**
 * Record a failed attempt and apply backoff if the threshold is reached.
 *
 * The increment is done in the database (`{ increment: 1 }`) rather than
 * read-modify-write, so concurrent attempts cannot both read "4" and each write
 * "5", letting an attacker exceed the threshold for free.
 */
export async function recordFailedAttempt(
  db: PrismaClient,
  userId: string,
  orgId: string,
  now: Date = new Date(),
): Promise<FailureRecord> {
  const threshold = await getLockoutThreshold(db, orgId);

  const user = await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: { increment: 1 } },
    select: { failedLoginCount: true },
  });

  const minutes = lockoutMinutesFor(user.failedLoginCount, threshold);
  if (minutes === 0) {
    return { failedLoginCount: user.failedLoginCount, lockedUntil: null, locked: false };
  }

  const lockedUntil = new Date(now.getTime() + minutes * 60_000);
  await db.user.update({ where: { id: userId }, data: { lockedUntil } });
  return { failedLoginCount: user.failedLoginCount, lockedUntil, locked: true };
}

/** Clear the counter after a successful sign-in. */
export async function clearFailedAttempts(db: Db, userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
}
