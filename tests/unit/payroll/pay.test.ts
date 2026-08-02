/** 21 T-4/T-5/T-6 — base, overtime, net money math (FR-3/4/5/15, AC-2..5/12). */
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_CONFIG } from "@/lib/constants/payroll";
import { basePaise, netPaise, overtimePaise } from "@/features/payroll/domain/pay";

const cfg = DEFAULT_PAYROLL_CONFIG; // divisor 26 × 480, mult 2.0
const SALARY = 3_100_000; // ₹31,000

describe("basePaise (AC-2/3)", () => {
  it("full month (31/31) = full salary (AC-2)", () => {
    expect(basePaise(SALARY, 31, 31)).toBe(3_100_000);
  });

  it("mid-month joiner (16/31) = ₹16,000 half-up (AC-3)", () => {
    expect(basePaise(SALARY, 16, 31)).toBe(1_600_000);
  });

  it("rounds half-up at the paisa", () => {
    // 3,100,000 × 29 / 31 = 2,900,000 exactly
    expect(basePaise(SALARY, 29, 31)).toBe(2_900_000);
    // a non-exact case rounds half-up
    expect(basePaise(SALARY, 10, 31)).toBe(1_000_000); // 31,000,000/31 = 1,000,000
  });

  it("zero basis guard → 0", () => {
    expect(basePaise(SALARY, 10, 0)).toBe(0);
  });
});

describe("overtimePaise (AC-4)", () => {
  it("600 OT minutes → 298,077 paise (₹2,981)", () => {
    // 3,100,000 / (26×480) × 600 × 2 = 298076.923… → 298077 half-up
    expect(overtimePaise(600, SALARY, cfg)).toBe(298_077);
  });

  it("zero OT → 0", () => {
    expect(overtimePaise(0, SALARY, cfg)).toBe(0);
  });

  it("zero divisor guard → 0", () => {
    expect(overtimePaise(600, SALARY, { ...cfg, otDivisorDays: 0 })).toBe(0);
  });
});

describe("netPaise — deduction before advance, floor at 0 (AC-5/12)", () => {
  it("AC-5: earnings − deduction − affordable advance", () => {
    const r = netPaise({ basePaise: 3_100_000, bonusPaise: 200_000, overtimePaise: 298_077, deductionPaise: 50_000, advanceOutstandingPaise: 100_000 });
    expect(r.advanceRecoveredPaise).toBe(100_000); // outstanding fully affordable
    expect(r.netPaise).toBe(3_448_077); // 3,598,077 − 50,000 − 100,000
  });

  it("AC-12: advance recovers only the remaining balance; net floors at 0; shortfall reported", () => {
    const r = netPaise({ basePaise: 3_100_000, bonusPaise: 200_000, overtimePaise: 298_100, deductionPaise: 50_000, advanceOutstandingPaise: 4_000_000 });
    // earnings 3,598,100 − deduction 50,000 = 3,548,100 remaining
    expect(r.advanceRecoveredPaise).toBe(3_548_100); // ₹35,481 recovered
    expect(r.netPaise).toBe(0); // never negative
    // carry-forward shortfall = 4,000,000 − 3,548,100 = 451,900 (₹4,519)
    expect(4_000_000 - r.advanceRecoveredPaise).toBe(451_900);
  });

  it("deduction exceeding earnings floors net at 0 and recovers nothing", () => {
    const r = netPaise({ basePaise: 100_000, bonusPaise: 0, overtimePaise: 0, deductionPaise: 500_000, advanceOutstandingPaise: 100_000 });
    expect(r.netPaise).toBe(0);
    expect(r.advanceRecoveredPaise).toBe(0);
  });

  it("no advance outstanding → net = earnings − deduction", () => {
    const r = netPaise({ basePaise: 1_000_000, bonusPaise: 0, overtimePaise: 0, deductionPaise: 0, advanceOutstandingPaise: 0 });
    expect(r.netPaise).toBe(1_000_000);
    expect(r.advanceRecoveredPaise).toBe(0);
  });
});
