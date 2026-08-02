/**
 * Payroll config — 21 T-1 (FR-3/4/18). One place for the pay-basis, overtime and
 * absence rules so a policy change is a data edit, not a code hunt. All values
 * are config-driven, never hard-coded into the computation (business-rules.md).
 *
 * Defaults follow the fixtures in specs/21-payroll/user-stories.md § Test
 * Fixtures (CFG) and the Factories Act §59 overtime rate (2×).
 */

/** `dayBasis`: "calendar" ⇒ the month's actual calendar days; a number pins it. */
export type PayrollDayBasis = "calendar" | number;

export type PayrollConfig = {
  /** Denominator for the pro-rata base (FR-3). Default: the month's calendar days. */
  dayBasis: PayrollDayBasis;
  /** OT ordinary-rate divisor in days (Factories Act convention). Default 26. */
  otDivisorDays: number;
  /** Standard paid minutes in a working day. Default 480 (8h). */
  standardMinutesPerDay: number;
  /** OT premium multiplier. Default 2.0 (Factories Act §59). */
  otMultiplier: number;
  /**
   * How an EMPLOYED day with no attendance record is treated (FR-18). Default
   * off ⇒ paid (do not auto-dock). An explicit `UNPAID` day is always LOP
   * regardless of this flag.
   */
  absenceIsLop: boolean;
};

export const DEFAULT_PAYROLL_CONFIG: PayrollConfig = {
  dayBasis: "calendar",
  otDivisorDays: 26,
  standardMinutesPerDay: 480,
  otMultiplier: 2.0,
  absenceIsLop: false,
};

function parseDayBasis(raw: string | undefined): PayrollDayBasis {
  if (!raw || raw.toLowerCase() === "calendar") return "calendar";
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : "calendar";
}

function num(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Resolve the effective config from env, falling back to the defaults. Reading
 * from env (not hard-coding) is what lets the client tune the pay basis / OT
 * policy without a code change (integrations.md "going live is a config change").
 */
export function resolvePayrollConfig(
  env: Record<string, string | undefined> = process.env,
): PayrollConfig {
  return {
    dayBasis: parseDayBasis(env.PAYROLL_DAY_BASIS),
    otDivisorDays: num(env.PAYROLL_OT_DIVISOR_DAYS, DEFAULT_PAYROLL_CONFIG.otDivisorDays),
    standardMinutesPerDay: num(env.PAYROLL_STANDARD_MINUTES_PER_DAY, DEFAULT_PAYROLL_CONFIG.standardMinutesPerDay),
    otMultiplier: num(env.PAYROLL_OT_MULTIPLIER, DEFAULT_PAYROLL_CONFIG.otMultiplier),
    absenceIsLop: (env.PAYROLL_ABSENCE_IS_LOP ?? "").toLowerCase() === "on"
      || (env.PAYROLL_ABSENCE_IS_LOP ?? "").toLowerCase() === "true",
  };
}
