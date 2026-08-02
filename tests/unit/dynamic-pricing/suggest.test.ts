/**
 * 24 T-3 — suggestRate occupancy/season/lead-time model + clamp (FR-1/3,
 * AC-1/2/7/8). Pure and deterministic; money in paise.
 *
 * CAT-DLX fixture: base ₹4,000 (400000), floor ₹3,000 (300000), ceil ₹8,000 (800000).
 */
import { describe, expect, it } from "vitest";
import {
  suggestRate,
  clampToGuardrail,
  withinGuardrail,
} from "@/features/dynamic-pricing/domain/suggest";

const BASE = 400_000;
const FLOOR = 300_000;
const CEIL = 800_000;

describe("suggestRate — demand pushes above base (AC-1)", () => {
  it("90% occupancy + peak season suggests above base, within the ceiling", () => {
    const s = suggestRate({
      basePaise: BASE,
      occupancyBps: 9_000, // 90% ⇒ x1.25
      leadTimeDays: 20, // neutral ⇒ x1.0
      isPeakSeason: true, // x1.1
      floorPaise: FLOOR,
      ceilPaise: CEIL,
    });
    // 400000 * 1.25 * 1.0 * 1.1 = 550000
    expect(s.suggestedPaise).toBe(550_000);
    expect(s.suggestedPaise).toBeGreaterThan(BASE);
    expect(s.suggestedPaise).toBeLessThanOrEqual(CEIL);
    expect(s.clamped).toBe(false);
  });
});

describe("suggestRate — guardrail clamp + flag (AC-2/AC-7)", () => {
  it("a raw suggestion above the ceiling is clamped down and flagged", () => {
    const s = suggestRate({
      basePaise: 800_000,
      occupancyBps: 9_000, // x1.25 ⇒ raw 1,000,000+ > ceil
      leadTimeDays: 1, // x1.08
      isPeakSeason: true, // x1.1
      floorPaise: FLOOR,
      ceilPaise: CEIL,
    });
    expect(s.suggestedPaise).toBe(CEIL);
    expect(s.clamped).toBe(true);
    expect(s.reason).toContain("clamped");
  });

  it("a raw suggestion below the floor is clamped up and flagged", () => {
    const s = suggestRate({
      basePaise: BASE,
      occupancyBps: 0, // x0.85 ⇒ raw 340000
      leadTimeDays: 60, // x0.97 ⇒ 329800
      isPeakSeason: false,
      floorPaise: 350_000,
      ceilPaise: CEIL,
    });
    expect(s.suggestedPaise).toBe(350_000);
    expect(s.clamped).toBe(true);
  });
});

describe("suggestRate — base-safe (AC-8)", () => {
  it("neutral occupancy/lead/season returns exactly base", () => {
    const s = suggestRate({
      basePaise: BASE,
      occupancyBps: 5_000, // 50% ⇒ x1.0
      leadTimeDays: 20, // x1.0
      isPeakSeason: false, // x1.0
      floorPaise: FLOOR,
      ceilPaise: CEIL,
    });
    expect(s.suggestedPaise).toBe(BASE);
    expect(s.clamped).toBe(false);
  });

  it("unbounded guardrails never clamp", () => {
    const s = suggestRate({ basePaise: BASE, occupancyBps: 9_500, leadTimeDays: 1, isPeakSeason: true });
    expect(s.clamped).toBe(false);
  });
});

describe("clampToGuardrail / withinGuardrail", () => {
  it("clamps into [floor, ceil]", () => {
    expect(clampToGuardrail(900_000, FLOOR, CEIL)).toBe(CEIL);
    expect(clampToGuardrail(100_000, FLOOR, CEIL)).toBe(FLOOR);
    expect(clampToGuardrail(500_000, FLOOR, CEIL)).toBe(500_000);
  });

  it("null bounds are unbounded on that side", () => {
    expect(clampToGuardrail(900_000, FLOOR, null)).toBe(900_000);
    expect(clampToGuardrail(100_000, null, CEIL)).toBe(100_000);
  });

  it("withinGuardrail rejects out-of-band rates", () => {
    expect(withinGuardrail(650_000, FLOOR, CEIL)).toBe(true);
    expect(withinGuardrail(900_000, FLOOR, CEIL)).toBe(false);
    expect(withinGuardrail(100_000, FLOOR, CEIL)).toBe(false);
    expect(withinGuardrail(900_000, FLOOR, null)).toBe(true);
  });
});
