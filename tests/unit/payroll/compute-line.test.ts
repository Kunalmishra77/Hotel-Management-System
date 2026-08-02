/** 21 — computeLine orchestrator (FR-2/3/4/5/13/15/18, AC-3/5/12/13/16). */
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_CONFIG } from "@/lib/constants/payroll";
import { computeLine } from "@/features/payroll/domain/compute-line";
import type { AttendanceDay } from "@/features/payroll/domain/lop";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const cfg = DEFAULT_PAYROLL_CONFIG;
const MONTH = "2026-07";
const SALARY = 3_100_000;

function day(iso: string, leaveType: string, overtimeMinutes = 0): AttendanceDay {
  return { day: D(iso), leaveType, isLeave: leaveType !== "NONE", workedMinutes: null, overtimeMinutes };
}

const anuAttendance = [
  day("2026-07-05", "UNPAID"),
  day("2026-07-06", "UNPAID"),
  day("2026-07-07", "SICK"),
  day("2026-07-10", "NONE", 300),
  day("2026-07-11", "NONE", 300),
];

describe("computeLine — S-ANU (AC-4/12/13)", () => {
  it("derives paid/LOP, base, OT and floors net against a large advance", () => {
    const line = computeLine({
      month: MONTH, monthlySalaryPaise: SALARY, joinedOn: D("2025-01-01"), leftOn: null,
      attendance: anuAttendance, cfg, advanceOutstandingPaise: 4_000_000,
    });
    expect(line.employedDays).toBe(31);
    expect(line.lopDays).toBe(2); // 2 UNPAID; SICK paid
    expect(line.paidDays).toBe(29);
    expect(line.basePaise).toBe(2_900_000); // 3,100,000 × 29/31
    expect(line.otMinutes).toBe(600);
    expect(line.overtimePaise).toBe(298_077);
    // earnings 3,198,077 all recovered against the ₹40,000 advance → net 0
    expect(line.advancePaise).toBe(3_198_077);
    expect(line.netPaise).toBe(0);
  });
});

describe("computeLine — mid-month joiner (AC-3)", () => {
  it("pro-rates base to 16/31 with no attendance and no advance", () => {
    const line = computeLine({
      month: MONTH, monthlySalaryPaise: SALARY, joinedOn: D("2026-07-16"), leftOn: null,
      attendance: [], cfg,
    });
    expect(line.employedDays).toBe(16);
    expect(line.lopDays).toBe(0);
    expect(line.paidDays).toBe(16);
    expect(line.basePaise).toBe(1_600_000);
    expect(line.netPaise).toBe(1_600_000);
  });
});

describe("computeLine — override (FR-13)", () => {
  it("uses the override values in place of the derived base/OT", () => {
    const line = computeLine({
      month: MONTH, monthlySalaryPaise: SALARY, joinedOn: D("2025-01-01"), leftOn: null,
      attendance: anuAttendance, cfg, overrideBasePaise: 3_100_000, overrideOvertimePaise: 0,
    });
    expect(line.basePaise).toBe(3_100_000);
    expect(line.overtimePaise).toBe(0);
    expect(line.netPaise).toBe(3_100_000);
  });
});

describe("computeLine — explicit bonus/deduction/advance (AC-5/12)", () => {
  it("applies provided components: net = earnings − deduction − affordable advance", () => {
    const line = computeLine({
      month: MONTH, monthlySalaryPaise: SALARY, joinedOn: D("2025-01-01"), leftOn: null,
      attendance: [], cfg, bonusPaise: 200_000, deductionPaise: 50_000, advanceOutstandingPaise: 100_000,
    });
    // full month, no attendance → base 3,100,000, ot 0
    expect(line.basePaise).toBe(3_100_000);
    expect(line.bonusPaise).toBe(200_000);
    expect(line.deductionPaise).toBe(50_000);
    expect(line.advancePaise).toBe(100_000);
    expect(line.netPaise).toBe(3_150_000); // 3,300,000 − 50,000 − 100,000
  });
});

describe("computeLine — over-attendance cap (AC-16)", () => {
  it("caps paidDays at the basis so base never exceeds the monthly salary", () => {
    // 40 recorded worked days (impossible in reality) must not over-pay.
    const many = Array.from({ length: 40 }, (_, i) => day(`2026-07-${String((i % 28) + 1).padStart(2, "0")}`, "NONE"));
    const line = computeLine({ month: MONTH, monthlySalaryPaise: SALARY, joinedOn: D("2025-01-01"), leftOn: null, attendance: many, cfg });
    expect(line.paidDays).toBeLessThanOrEqual(31);
    expect(line.basePaise).toBeLessThanOrEqual(SALARY);
  });
});
