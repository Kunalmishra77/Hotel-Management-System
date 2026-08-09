/**
 * 27 owner-portal — payout math (FR-11, AC-13/14). Numbers in paise.
 */
import { describe, expect, it } from "vitest";
import { computePayout, monthStart, monthEnd } from "@/features/owner-portal/domain/payout";

describe("computePayout (AC-13/14)", () => {
  it("management-fee model: fee = 15% of revenue, net = revenue − expenses − fee", () => {
    // ₹5,00,000 revenue, ₹1,80,000 expenses, 15% fee → ₹75,000 fee, ₹2,45,000 net.
    const r = computePayout(50_000_000n, 18_000_000n, 1500);
    expect(r.managementFeePaise).toBe(7_500_000n);
    expect(r.netPayablePaise).toBe(24_500_000n);
  });

  it("allows a negative net in a loss month (never clamped)", () => {
    const r = computePayout(10_000_000n, 15_000_000n, 1500);
    expect(r.netPayablePaise).toBe(10_000_000n - 15_000_000n - 1_500_000n); // −6,500,000
    expect(r.netPayablePaise < 0n).toBe(true);
  });

  it("zero fee → net = revenue − expenses", () => {
    const r = computePayout(50_000_000n, 18_000_000n, 0);
    expect(r.managementFeePaise).toBe(0n);
    expect(r.netPayablePaise).toBe(32_000_000n);
  });

  it("rounds the fee half-up to the paisa", () => {
    // 12345 × 333 / 10000 = 411.0885 → 411 paise
    expect(computePayout(12_345n, 0n, 333).managementFeePaise).toBe(411n);
    // 5 × 5000 / 10000 = 2.5 → 3 (half-up)
    expect(computePayout(5n, 0n, 5000).managementFeePaise).toBe(3n);
  });

  it("month bounds", () => {
    expect(monthStart(new Date("2026-08-09T12:00:00Z")).toISOString().slice(0, 10)).toBe("2026-08-01");
    expect(monthEnd(new Date("2026-02-15T00:00:00Z")).toISOString().slice(0, 10)).toBe("2026-02-28");
  });
});
