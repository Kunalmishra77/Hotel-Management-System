/**
 * Failed-login lockout for the guest email/password path (Phase 2) — mirrors the
 * staff lockout policy. Pure helpers; the action persists `failedLoginCount` /
 * `lockedUntil` on `GuestAccount`. Clock injected for testability.
 */
export const GUEST_MAX_FAILED_LOGINS = 5;
export const GUEST_LOCK_MINUTES = 15;

export function isLocked(lockedUntil: Date | null, now: Date): boolean {
  return lockedUntil !== null && lockedUntil.getTime() > now.getTime();
}

/** Next `(failedLoginCount, lockedUntil)` after a failed attempt. */
export function nextLockState(
  currentFailures: number,
  now: Date,
): { failedLoginCount: number; lockedUntil: Date | null } {
  const failedLoginCount = currentFailures + 1;
  const lockedUntil =
    failedLoginCount >= GUEST_MAX_FAILED_LOGINS
      ? new Date(now.getTime() + GUEST_LOCK_MINUTES * 60_000)
      : null;
  return { failedLoginCount, lockedUntil };
}
