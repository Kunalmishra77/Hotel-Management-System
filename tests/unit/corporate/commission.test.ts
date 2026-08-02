/**
 * 25 travel-agent commission — T-5 (FR-6, AC-6). Pure, BigInt, half-up rounding.
 */
import { describe, expect, it } from "vitest";
import { commissionOnRevenue, commissionPayable } from "@/features/corporate/domain/commission";

describe("commissionOnRevenue (AC-6)", () => {
  it("is 10% (1000 bps) of room revenue", () => {
    // ₹1,00,000 room revenue → ₹10,000 commission.
    expect(commissionOnRevenue(10_000_000n, 1000)).toBe(1_000_000n);
  });
  it("rounds half-up to the paisa", () => {
    // 12345 × 1000 / 10000 = 1234.5 → 1235.
    expect(commissionOnRevenue(12_345n, 1000)).toBe(1235n);
  });
  it("is zero for a zero rate or zero revenue", () => {
    expect(commissionOnRevenue(10_000_000n, 0)).toBe(0n);
    expect(commissionOnRevenue(0n, 1000)).toBe(0n);
  });
});

describe("commissionPayable (AC-6)", () => {
  it("sums room revenue across bookings, then applies the rate once", () => {
    const bookings = [{ roomRevenuePaise: 6_000_000n }, { roomRevenuePaise: 4_000_000n }];
    // (₹60,000 + ₹40,000) × 10% = ₹10,000.
    expect(commissionPayable(bookings, 1000)).toBe(1_000_000n);
  });
  it("ignores non-positive room revenue", () => {
    const bookings = [{ roomRevenuePaise: 10_000_000n }, { roomRevenuePaise: -5_000n }];
    expect(commissionPayable(bookings, 1000)).toBe(1_000_000n);
  });
  it("is zero for no bookings", () => {
    expect(commissionPayable([], 1000)).toBe(0n);
  });
});
