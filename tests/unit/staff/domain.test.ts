/**
 * 09 staff domain — T-3/T-4/T-5 (FR-4/6/7, AC-4/5/7/9). Pure.
 */
import { describe, expect, it } from "vitest";
import { workedMinutes, monthlySummary } from "@/features/staff/domain/attendance";
import { maskId } from "@/features/staff/domain/mask";

describe("workedMinutes (AC-5/6)", () => {
  it("09:00 → 17:30 = 510 minutes", () => {
    expect(workedMinutes(new Date("2026-07-12T09:00:00+05:30"), new Date("2026-07-12T17:30:00+05:30"))).toBe(510);
  });
  it("handles an overnight shift (out next day)", () => {
    expect(workedMinutes(new Date("2026-07-12T22:00:00Z"), new Date("2026-07-13T06:00:00Z"))).toBe(480);
  });
  it("returns 0 when check-out is not after check-in (invalid, action rejects)", () => {
    expect(workedMinutes(new Date("2026-07-12T09:00:00Z"), new Date("2026-07-12T08:00:00Z"))).toBe(0);
  });
});

describe("monthlySummary (AC-9)", () => {
  const staff = { joinedOn: new Date("2025-01-01"), leftOn: null };
  it("counts worked/leave days, sums OT, and employed days across the month", () => {
    const att = [
      { day: new Date("2026-07-12"), isLeave: false, workedMinutes: 510, overtimeMinutes: 0 },
      { day: new Date("2026-07-13"), isLeave: false, workedMinutes: 480, overtimeMinutes: 90 },
      { day: new Date("2026-07-14"), isLeave: true, workedMinutes: null, overtimeMinutes: 0 },
    ];
    const s = monthlySummary(att, "2026-07", staff);
    expect(s.workedDays).toBe(2);
    expect(s.leaveDays).toBe(1);
    expect(s.overtimeMinutes).toBe(90);
    expect(s.employedDays).toBe(31); // employed all of July
  });
  it("prorates employed days for a mid-month joiner", () => {
    const s = monthlySummary([], "2026-07", { joinedOn: new Date("2026-07-20"), leftOn: null });
    expect(s.employedDays).toBe(12); // 20th–31st inclusive
  });
  it("is zero for a month before joining", () => {
    const s = monthlySummary([], "2024-01", staff);
    expect(s.employedDays).toBe(0);
  });
});

describe("maskId (AC-4)", () => {
  it("masks Aadhaar to last 4 in UIDAI form", () => {
    expect(maskId("AADHAAR", "1234 5678 9012")).toBe("XXXX XXXX 9012");
  });
  it("masks PAN to last 4", () => {
    expect(maskId("PAN", "ABCDE1234F")).toBe("XXXXXX234F");
  });
  it("returns null for empty", () => {
    expect(maskId("AADHAAR", null)).toBeNull();
  });
});
