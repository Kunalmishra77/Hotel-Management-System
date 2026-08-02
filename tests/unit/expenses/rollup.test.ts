/**
 * 07 expense rollup domain — T-3 (FR-5, AC-5). Pure aggregation.
 */
import { describe, expect, it } from "vitest";
import { rollup, totalPaise, type RollupExpense } from "@/features/expenses/domain/rollup";

const e = (o: Partial<RollupExpense>): RollupExpense => ({
  propertyId: "prop_a", head: "KITCHEN", spentOn: new Date("2026-07-12T00:00:00Z"), amountPaise: 120_000, ...o,
});

describe("rollup (AC-5)", () => {
  const rows = [
    e({ head: "KITCHEN", amountPaise: 120_000 }), // ₹1,200 veg, 12 Jul
    e({ head: "UTILITIES", amountPaise: 800_000 }), // ₹8,000 electricity, 12 Jul
    e({ head: "KITCHEN", amountPaise: 50_000, spentOn: new Date("2026-08-01T00:00:00Z") }),
  ];

  it("totals the day (₹9,200 on 12 Jul)", () => {
    const july12 = rows.filter((r) => r.spentOn.getUTCMonth() === 6);
    expect(totalPaise(july12)).toBe(920_000);
    expect(rollup(july12, "day")["2026-07-12"]).toBe(920_000);
  });

  it("groups by month", () => {
    const byMonth = rollup(rows, "month");
    expect(byMonth["2026-07"]).toBe(920_000);
    expect(byMonth["2026-08"]).toBe(50_000);
  });

  it("groups by head", () => {
    const byHead = rollup(rows, "head");
    expect(byHead.KITCHEN).toBe(170_000);
    expect(byHead.UTILITIES).toBe(800_000);
  });

  it("groups by property", () => {
    const mixed = [...rows, e({ propertyId: "prop_b", amountPaise: 10_000 })];
    const byProp = rollup(mixed, "property");
    expect(byProp.prop_a).toBe(970_000);
    expect(byProp.prop_b).toBe(10_000);
  });

  it("is empty for no expenses", () => {
    expect(rollup([], "day")).toEqual({});
    expect(totalPaise([])).toBe(0);
  });
});
