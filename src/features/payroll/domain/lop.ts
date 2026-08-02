/**
 * Loss-of-pay (LOP) + paid-days — 21 T-3b (FR-3/18, AC-13/16).
 *
 * LOP is derived per employed day from `leaveType`:
 *   - `UNPAID`                       → LOP (docked), ALWAYS, regardless of config
 *   - `PAID` / `CASUAL` / `SICK`     → paid (not LOP)
 *   - a normal worked day            → paid
 *   - an employed day with NO record → config: `absenceIsLop` off ⇒ paid, on ⇒ LOP
 *
 * The explicit-`UNPAID`-always-LOP rule closes the prior gap where only missing
 * days could become LOP (FR-18). Pure & deterministic.
 */
import type { PayrollConfig } from "@/lib/constants/payroll";

export type AttendanceDay = {
  day: Date;
  isLeave: boolean;
  /** `LeaveType` enum as a string: NONE | CASUAL | SICK | PAID | UNPAID. */
  leaveType: string;
  workedMinutes: number | null;
  overtimeMinutes: number;
};

/**
 * LOP days for the month. `employedDays` bounds both the "missing record" count
 * and the final result, so LOP can never exceed the days actually employed.
 */
export function lopDays(
  attendance: AttendanceDay[],
  employed: number,
  cfg: PayrollConfig,
): number {
  const unpaidRecords = attendance.filter((a) => a.leaveType === "UNPAID").length;

  // Days in the employed window with no attendance row at all.
  const recorded = Math.min(attendance.length, employed);
  const unrecorded = Math.max(0, employed - recorded);
  const absenceLop = cfg.absenceIsLop ? unrecorded : 0;

  return Math.min(unpaidRecords + absenceLop, employed);
}

/**
 * Paid days = `min(employedDays − lopDays, daysInBasis)` — capped at the basis
 * (FR-3, AC-16) so a full or over-attended month never pays above the monthly
 * salary. Floored at 0.
 */
export function paidDays(employed: number, lop: number, basis: number): number {
  return Math.max(0, Math.min(employed - lop, basis));
}

/** Total overtime minutes over the month (FR-4). */
export function totalOvertimeMinutes(attendance: AttendanceDay[]): number {
  return attendance.reduce((sum, a) => sum + (a.overtimeMinutes || 0), 0);
}
