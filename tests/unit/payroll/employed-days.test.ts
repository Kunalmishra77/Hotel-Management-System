/** 21 T-3/T-7 — employedDays (single authority) + eligibility (FR-3/11, AC-1/3/17). */
import { describe, expect, it } from "vitest";
import { employedDays, isEligible } from "@/features/payroll/domain/employed-days";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const MONTH = "2026-07"; // 31 days

describe("employedDays (AC-3/17)", () => {
  it("full month employed → 31", () => {
    expect(employedDays(MONTH, D("2025-01-01"), null)).toBe(31);
  });

  it("mid-month joiner (16 Jul) → 16 (AC-3)", () => {
    expect(employedDays(MONTH, D("2026-07-16"), null)).toBe(16);
  });

  it("mid-month leaver (left 20 Jul) → 20", () => {
    expect(employedDays(MONTH, D("2025-01-01"), D("2026-07-20"))).toBe(20);
  });

  it("joined after the month → 0", () => {
    expect(employedDays(MONTH, D("2026-08-01"), null)).toBe(0);
  });

  it("left before the month → 0", () => {
    expect(employedDays(MONTH, D("2024-01-01"), D("2026-06-30"))).toBe(0);
  });

  it("employment straddling both boundaries → full month", () => {
    expect(employedDays(MONTH, D("2026-06-15"), D("2026-08-15"))).toBe(31);
  });
});

describe("isEligible (FR-11, AC-1)", () => {
  it("employed during the month → eligible", () => {
    expect(isEligible({ joinedOn: D("2025-01-01"), leftOn: null }, MONTH)).toBe(true);
    expect(isEligible({ joinedOn: D("2026-07-16"), leftOn: null }, MONTH)).toBe(true);
  });

  it("left before the month (S-EX) → excluded", () => {
    expect(isEligible({ joinedOn: D("2024-01-01"), leftOn: D("2026-06-30") }, MONTH)).toBe(false);
  });

  it("joined after the month → excluded", () => {
    expect(isEligible({ joinedOn: D("2026-08-01"), leftOn: null }, MONTH)).toBe(false);
  });
});
