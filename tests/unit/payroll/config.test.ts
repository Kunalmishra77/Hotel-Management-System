/** 21 T-1 — payroll config resolution from env (FR-3/4/18). */
import { describe, expect, it } from "vitest";
import { DEFAULT_PAYROLL_CONFIG, resolvePayrollConfig } from "@/lib/constants/payroll";

describe("resolvePayrollConfig", () => {
  it("falls back to defaults with an empty env", () => {
    expect(resolvePayrollConfig({})).toEqual(DEFAULT_PAYROLL_CONFIG);
  });

  it("parses a pinned numeric day basis, and 'calendar'/invalid → calendar", () => {
    expect(resolvePayrollConfig({ PAYROLL_DAY_BASIS: "30" }).dayBasis).toBe(30);
    expect(resolvePayrollConfig({ PAYROLL_DAY_BASIS: "calendar" }).dayBasis).toBe("calendar");
    expect(resolvePayrollConfig({ PAYROLL_DAY_BASIS: "nonsense" }).dayBasis).toBe("calendar");
    expect(resolvePayrollConfig({ PAYROLL_DAY_BASIS: "-5" }).dayBasis).toBe("calendar");
  });

  it("reads OT divisor/std-minutes/multiplier, ignoring invalid values", () => {
    const cfg = resolvePayrollConfig({ PAYROLL_OT_DIVISOR_DAYS: "30", PAYROLL_STANDARD_MINUTES_PER_DAY: "540", PAYROLL_OT_MULTIPLIER: "1.5" });
    expect(cfg.otDivisorDays).toBe(30);
    expect(cfg.standardMinutesPerDay).toBe(540);
    expect(cfg.otMultiplier).toBe(1.5);
    const bad = resolvePayrollConfig({ PAYROLL_OT_DIVISOR_DAYS: "abc", PAYROLL_OT_MULTIPLIER: "0" });
    expect(bad.otDivisorDays).toBe(DEFAULT_PAYROLL_CONFIG.otDivisorDays);
    expect(bad.otMultiplier).toBe(DEFAULT_PAYROLL_CONFIG.otMultiplier);
  });

  it("treats absence flag 'on'/'true' as LOP; anything else as paid", () => {
    expect(resolvePayrollConfig({ PAYROLL_ABSENCE_IS_LOP: "on" }).absenceIsLop).toBe(true);
    expect(resolvePayrollConfig({ PAYROLL_ABSENCE_IS_LOP: "true" }).absenceIsLop).toBe(true);
    expect(resolvePayrollConfig({ PAYROLL_ABSENCE_IS_LOP: "off" }).absenceIsLop).toBe(false);
    expect(resolvePayrollConfig({}).absenceIsLop).toBe(false);
  });
});
