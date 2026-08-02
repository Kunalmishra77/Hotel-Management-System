/**
 * Traceability: 00 FR-4, AC-4 — lockout/backoff with an injected clock.
 * The pure curve is tested here; the DB-backed counter is exercised in
 * tests/integration/auth-lockout.test.ts.
 */
import { describe, expect, it } from "vitest";
import {
  BASE_LOCKOUT_MINUTES,
  MAX_LOCKOUT_MINUTES,
  isLocked,
  lockoutMinutesFor,
} from "@/lib/auth/lockout";

const THRESHOLD = 5; // SecuritySettings.lockoutThreshold default (AC-4)

describe("lockoutMinutesFor", () => {
  it("costs nothing below the threshold — early typos must not punish", () => {
    for (let n = 0; n < THRESHOLD; n++) {
      expect(lockoutMinutesFor(n, THRESHOLD)).toBe(0);
    }
  });

  it("locks on reaching the threshold (AC-4)", () => {
    expect(lockoutMinutesFor(THRESHOLD, THRESHOLD)).toBe(BASE_LOCKOUT_MINUTES);
  });

  it("doubles with each further failure", () => {
    expect(lockoutMinutesFor(THRESHOLD + 1, THRESHOLD)).toBe(BASE_LOCKOUT_MINUTES * 2);
    expect(lockoutMinutesFor(THRESHOLD + 2, THRESHOLD)).toBe(BASE_LOCKOUT_MINUTES * 4);
    expect(lockoutMinutesFor(THRESHOLD + 3, THRESHOLD)).toBe(BASE_LOCKOUT_MINUTES * 8);
  });

  it("caps so an account can never be bricked by sustained attack", () => {
    expect(lockoutMinutesFor(THRESHOLD + 50, THRESHOLD)).toBe(MAX_LOCKOUT_MINUTES);
    expect(lockoutMinutesFor(10_000, THRESHOLD)).toBe(MAX_LOCKOUT_MINUTES);
  });

  it("honours a different org threshold (config, not a constant)", () => {
    expect(lockoutMinutesFor(2, 3)).toBe(0);
    expect(lockoutMinutesFor(3, 3)).toBe(BASE_LOCKOUT_MINUTES);
  });
});

describe("isLocked", () => {
  const now = new Date("2026-07-21T10:00:00.000Z");

  it("is false when never locked", () => {
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(undefined, now)).toBe(false);
  });

  it("is true while the lock is in the future", () => {
    expect(isLocked(new Date(now.getTime() + 1000), now)).toBe(true);
  });

  it("expires on its own — no unlock job required", () => {
    expect(isLocked(new Date(now.getTime() - 1), now)).toBe(false);
    expect(isLocked(now, now)).toBe(false);
  });
});
