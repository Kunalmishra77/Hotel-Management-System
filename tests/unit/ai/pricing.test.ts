/**
 * 18 T-7 — rate-suggestion math (FR-7, AC-8). Grounded; clamped to floor/ceil.
 */
import { describe, expect, it } from "vitest";
import { suggestRateForDate } from "@/features/ai/domain/pricing";

const base = {
  date: "2026-06-15",
  baseRatePaise: 400000, // ₹4,000
  floorPaise: 300000,
  ceilPaise: 500000,
  leadDays: 20,
  isPeakSeason: false,
};

describe("suggestRateForDate (AC-8)", () => {
  it("raises the rate under high occupancy", () => {
    const low = suggestRateForDate({ ...base, occupancy: 0.2 });
    const high = suggestRateForDate({ ...base, occupancy: 0.95 });
    expect(high.suggestedPaise).toBeGreaterThan(low.suggestedPaise);
  });

  it("never exceeds the ceiling", () => {
    const r = suggestRateForDate({ ...base, occupancy: 0.99, leadDays: 1, isPeakSeason: true, ceilPaise: 420000 });
    expect(r.suggestedPaise).toBeLessThanOrEqual(420000);
  });

  it("never drops below the floor", () => {
    const r = suggestRateForDate({ ...base, occupancy: 0.05, leadDays: 60, floorPaise: 380000 });
    expect(r.suggestedPaise).toBeGreaterThanOrEqual(380000);
  });

  it("carries a human-readable rationale for the 24 approval screen", () => {
    const r = suggestRateForDate({ ...base, occupancy: 0.9 });
    expect(r.reason).toContain("occupancy");
  });
});
