/**
 * 08 profit domain — T-1 (FR-1/3/6, AC-1/8/9). Pure.
 */
import { describe, expect, it } from "vitest";
import { apportionStaffCost, incomeVsExpense } from "@/features/reports/domain/profit";
import { profit } from "@/features/analytics/domain/metrics";

describe("apportionStaffCost (AC-9)", () => {
  it("spreads ₹1,50,000 over 31 days → ~₹4,838.71/day (483871 paise)", () => {
    expect(apportionStaffCost(15_000_000, 31, 1)).toBe(483_871);
  });
  it("a full month reconciles back to the finalized net", () => {
    expect(apportionStaffCost(15_000_000, 31, 31)).toBe(15_000_000);
  });
  it("a partial range is proportional", () => {
    expect(apportionStaffCost(15_000_000, 31, 10)).toBe(4_838_710);
  });
});

describe("incomeVsExpense (AC-1/8) — staff cost counted once", () => {
  it("computes the AC-1 profit: ₹6,80,000 − (₹2,10,000 + ₹1,50,000) = ₹3,20,000", () => {
    const b = incomeVsExpense(
      { ROOM: 60_000_000, FOOD: 8_000_000 }, // ₹6,00,000 + ₹80,000
      { HOUSEKEEPING: 5_000_000, UTILITIES: 16_000_000 }, // ₹2,10,000 total 07 (excl staff)
      15_000_000, // ₹1,50,000 finalized payroll staff cost (21)
    );
    expect(b.revenuePaise).toBe(68_000_000);
    expect(b.expensePaise).toBe(36_000_000); // 21,00,000... = ₹3,60,000
    expect(b.profitPaise).toBe(32_000_000);  // ₹3,20,000
    expect(b.staffCostPaise).toBe(15_000_000);
  });

  it("never folds staff cost into an expense head", () => {
    const b = incomeVsExpense({ ROOM: 100 }, { HOUSEKEEPING: 50 }, 40);
    expect(b.expenseByHead.STAFF).toBeUndefined();
    expect(Object.values(b.expenseByHead).reduce((a, x) => a + x, 0)).toBe(50); // 07 only
    expect(b.expensePaise).toBe(90); // 50 + 40 staff
  });

  it("reuses 14's profit function", () => {
    expect(Number(profit(68_000_000n, 36_000_000n))).toBe(32_000_000);
  });
});
