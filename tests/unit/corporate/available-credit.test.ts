/**
 * 25 credit domain — T-3 (FR-3, AC-3/4). Pure, BigInt paise. This is the exact
 * predicate `reserveCredit` applies under the row lock.
 */
import { describe, expect, it } from "vitest";
import { availableCredit, exceedsLimit } from "@/features/corporate/domain/available-credit";

// ACME fixture: limit ₹2,00,000, receivable ₹1,50,000 (paise).
const LIMIT = 20_000_000n;
const RECEIVABLE = 15_000_000n;

describe("availableCredit (AC-3)", () => {
  it("is limit − receivable", () => {
    expect(availableCredit(LIMIT, RECEIVABLE)).toBe(5_000_000n);
  });
  it("floors at zero when over limit (never negative)", () => {
    expect(availableCredit(LIMIT, 25_000_000n)).toBe(0n);
  });
  it("equals the full limit for a fresh account", () => {
    expect(availableCredit(LIMIT, 0n)).toBe(LIMIT);
  });
});

describe("exceedsLimit (AC-3/4)", () => {
  it("allows a settlement that fits (₹40,000 → ₹1,90,000 ≤ limit)", () => {
    expect(exceedsLimit(LIMIT, RECEIVABLE, 4_000_000n)).toBe(false);
  });
  it("rejects a settlement over the limit (₹60,000 → ₹2,10,000 > limit)", () => {
    expect(exceedsLimit(LIMIT, RECEIVABLE, 6_000_000n)).toBe(true);
  });
  it("allows landing exactly on the limit (₹50,000 → ₹2,00,000)", () => {
    expect(exceedsLimit(LIMIT, RECEIVABLE, 5_000_000n)).toBe(false);
  });
  it("rejects one paisa over the limit", () => {
    expect(exceedsLimit(LIMIT, RECEIVABLE, 5_000_001n)).toBe(true);
  });
});
