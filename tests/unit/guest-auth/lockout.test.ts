/**
 * Traceability: Phase 2 (customer redesign) — guest email/password lockout.
 *
 * Mirrors the staff lockout: repeated failures must lock the account for a window
 * so the password path can't be ground down. Pure, clock-injected.
 */
import { describe, expect, it } from "vitest";
import {
  GUEST_MAX_FAILED_LOGINS,
  GUEST_LOCK_MINUTES,
  isLocked,
  nextLockState,
} from "@/lib/guest-auth/lockout";

const NOW = new Date("2026-08-14T10:00:00.000Z");

describe("isLocked", () => {
  it("is false when there is no lock", () => {
    expect(isLocked(null, NOW)).toBe(false);
  });

  it("is true while the lock is in the future, false once it passes", () => {
    expect(isLocked(new Date(NOW.getTime() + 60_000), NOW)).toBe(true);
    expect(isLocked(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });
});

describe("nextLockState", () => {
  it("increments failures without locking below the threshold", () => {
    const s = nextLockState(0, NOW);
    expect(s.failedLoginCount).toBe(1);
    expect(s.lockedUntil).toBeNull();
  });

  it("locks exactly at the threshold for the configured window", () => {
    const s = nextLockState(GUEST_MAX_FAILED_LOGINS - 1, NOW);
    expect(s.failedLoginCount).toBe(GUEST_MAX_FAILED_LOGINS);
    expect(s.lockedUntil).not.toBeNull();
    expect(s.lockedUntil!.getTime()).toBe(NOW.getTime() + GUEST_LOCK_MINUTES * 60_000);
  });

  it("keeps locking on further failures past the threshold", () => {
    const s = nextLockState(GUEST_MAX_FAILED_LOGINS, NOW);
    expect(s.failedLoginCount).toBe(GUEST_MAX_FAILED_LOGINS + 1);
    expect(s.lockedUntil).not.toBeNull();
  });
});
