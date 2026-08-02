/** 20 T-3 — onHand from movements (FR-1, AC-2). Pure domain, no I/O. */
import { describe, expect, it } from "vitest";
import { onHand, round6 } from "@/features/inventory/domain/on-hand";

describe("onHand (T-3, FR-1)", () => {
  it("sums an empty movement list to zero", () => {
    expect(onHand([])).toBe(0);
  });

  it("sums a purchase onto opening stock (AC-2: 25 + 50 = 75)", () => {
    expect(onHand([{ delta: 25 }, { delta: 50 }])).toBe(75);
  });

  it("nets purchases against consumption", () => {
    expect(onHand([{ delta: 5.5 }, { delta: -1.0 }])).toBe(4.5);
  });

  it("avoids float drift from fractional deltas", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE-754 — round6 keeps it clean.
    expect(onHand([{ delta: 0.1 }, { delta: 0.2 }])).toBe(0.3);
  });
});

describe("round6", () => {
  it("rounds 0.02 * 50 to exactly 1", () => {
    expect(round6(0.02 * 50)).toBe(1);
  });
});
