/** 21 T-3b — LOP by leaveType + paidDays cap (FR-3/18, AC-13/16). */
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_CONFIG } from "@/lib/constants/payroll";
import { lopDays, paidDays, totalOvertimeMinutes, type AttendanceDay } from "@/features/payroll/domain/lop";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const cfg = DEFAULT_PAYROLL_CONFIG; // absenceIsLop off
const cfgLop = { ...DEFAULT_PAYROLL_CONFIG, absenceIsLop: true };

function day(iso: string, leaveType: string, overtimeMinutes = 0): AttendanceDay {
  return { day: D(iso), leaveType, isLeave: leaveType !== "NONE", workedMinutes: null, overtimeMinutes };
}

describe("lopDays (AC-13)", () => {
  it("UNPAID days count as LOP; SICK/PAID/CASUAL do not", () => {
    const att = [day("2026-07-05", "UNPAID"), day("2026-07-06", "UNPAID"), day("2026-07-07", "SICK")];
    // 31 employed, only 3 records → absence off means missing days paid → LOP = 2 UNPAID.
    expect(lopDays(att, 31, cfg)).toBe(2);
  });

  it("worked days (NONE) are paid, not LOP", () => {
    const att = [day("2026-07-10", "NONE"), day("2026-07-11", "PAID"), day("2026-07-12", "CASUAL")];
    expect(lopDays(att, 31, cfg)).toBe(0);
  });

  it("absenceIsLop OFF: employed days with no record are paid", () => {
    expect(lopDays([], 31, cfg)).toBe(0);
  });

  it("absenceIsLop ON: employed days with no record become LOP", () => {
    // 31 employed, 1 recorded worked day → 30 missing → LOP.
    expect(lopDays([day("2026-07-10", "NONE")], 31, cfgLop)).toBe(30);
  });

  it("explicit UNPAID is ALWAYS LOP, regardless of the flag", () => {
    const att = [day("2026-07-05", "UNPAID")];
    expect(lopDays(att, 31, cfg)).toBe(1); // flag off, still docked
    // flag on: the 1 unpaid + 30 missing days = capped at employed (31).
    expect(lopDays(att, 31, cfgLop)).toBe(31);
  });

  it("LOP never exceeds employed days", () => {
    const att = [day("2026-07-05", "UNPAID"), day("2026-07-06", "UNPAID")];
    expect(lopDays(att, 1, cfg)).toBe(1);
  });
});

describe("paidDays (AC-16)", () => {
  it("normal case = employed − lop", () => {
    expect(paidDays(31, 2, 31)).toBe(29);
  });

  it("capped at daysInBasis so base never exceeds salary (AC-16)", () => {
    expect(paidDays(35, 0, 31)).toBe(31);
  });

  it("floored at 0", () => {
    expect(paidDays(5, 10, 31)).toBe(0);
  });
});

describe("totalOvertimeMinutes (AC-4)", () => {
  it("sums per-day overtime", () => {
    expect(totalOvertimeMinutes([day("2026-07-10", "NONE", 300), day("2026-07-11", "NONE", 300)])).toBe(600);
  });
});
