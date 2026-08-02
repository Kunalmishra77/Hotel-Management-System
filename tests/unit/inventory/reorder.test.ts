/** 20 T-5 — belowReorder strict `<` boundary (FR-4, AC-5). */
import { describe, expect, it } from "vitest";
import { belowReorder, crossedBelowReorder } from "@/features/inventory/domain/reorder";

describe("belowReorder (T-5, FR-4)", () => {
  it("is true when on-hand is strictly below the level (4.5 < 5)", () => {
    expect(belowReorder(4.5, 5)).toBe(true);
  });

  it("is FALSE when on-hand lands exactly on the level (5 == 5 does not fire)", () => {
    expect(belowReorder(5, 5)).toBe(false);
  });

  it("is false when on-hand is above the level (5.5 > 5)", () => {
    expect(belowReorder(5.5, 5)).toBe(false);
  });
});

describe("crossedBelowReorder (LowStockDetected trigger)", () => {
  it("fires when on-hand drops from ≥ level to < level (5.5 → 4.5, level 5) (AC-5)", () => {
    expect(crossedBelowReorder(5.5, 4.5, 5)).toBe(true);
  });

  it("does NOT fire when landing exactly on the level (5.5 → 5.0)", () => {
    expect(crossedBelowReorder(5.5, 5, 5)).toBe(false);
  });

  it("does NOT re-fire when already below (4.5 → 4.0)", () => {
    expect(crossedBelowReorder(4.5, 4, 5)).toBe(false);
  });
});
