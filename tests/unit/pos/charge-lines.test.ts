import { describe, it, expect } from "vitest";
import { groupPosChargeLines } from "@/features/pos/domain/charge-lines";

describe("groupPosChargeLines (19 R-35, FR-4)", () => {
  it("groups a single-rate order into one line (unchanged behaviour)", () => {
    const groups = groupPosChargeLines(
      [
        { quantity: 2, unitPaise: 12_000, gstBps: 500, hsnSac: "996331" },
        { quantity: 1, unitPaise: 6_000, gstBps: 500, hsnSac: "996331" },
      ],
      0,
    );
    expect(groups).toEqual([{ gstBps: 500, hsnSac: "996331", taxablePaise: 30_000 }]);
  });

  it("splits a mixed-rate order into one line per rate", () => {
    const groups = groupPosChargeLines(
      [
        { quantity: 2, unitPaise: 12_000, gstBps: 500, hsnSac: "996331" }, // 24000 @ 5%
        { quantity: 1, unitPaise: 20_000, gstBps: 1800, hsnSac: "996311" }, // 20000 @ 18%
      ],
      0,
    );
    expect(groups).toEqual([
      { gstBps: 500, hsnSac: "996331", taxablePaise: 24_000 },
      { gstBps: 1800, hsnSac: "996311", taxablePaise: 20_000 },
    ]);
  });

  it("apportions the discount by subtotal share; the last group absorbs the remainder", () => {
    // subtotal 30000; discount 1000. 5% group 20000 → 667 (round half-up of 666.67);
    // last (18%) group absorbs the rest → 333.
    const groups = groupPosChargeLines(
      [
        { quantity: 1, unitPaise: 20_000, gstBps: 500, hsnSac: "996331" },
        { quantity: 1, unitPaise: 10_000, gstBps: 1800, hsnSac: "996311" },
      ],
      1_000,
    );
    // Σ taxable == subtotal − discount (29000), exactly.
    expect(groups.reduce((s, g) => s + g.taxablePaise, 0)).toBe(29_000);
    expect(groups[0]!.taxablePaise).toBe(20_000 - 667);
    expect(groups[1]!.taxablePaise).toBe(10_000 - 333);
  });

  it("returns [] for an empty order", () => {
    expect(groupPosChargeLines([], 0)).toEqual([]);
  });

  it("clamps a discount larger than the subtotal", () => {
    const groups = groupPosChargeLines([{ quantity: 1, unitPaise: 5_000, gstBps: 500 }], 9_999);
    expect(groups).toEqual([{ gstBps: 500, hsnSac: null, taxablePaise: 0 }]);
  });
});
