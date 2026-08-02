/**
 * Payroll money math — 21 T-4/T-5/T-6 (FR-3/4/5/15, AC-2..5/12).
 *
 * All money is integer paise; every division rounds HALF-UP to the paisa via
 * Decimal.js (business-rules.md §8). Pure & deterministic — no clock, no I/O.
 */
import Decimal from "decimal.js";
import type { PayrollConfig } from "@/lib/constants/payroll";

function roundHalfUp(d: Decimal): number {
  return d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

/**
 * Pro-rated base (FR-3): `monthlySalary × paidDays ÷ daysInBasis`, half-up.
 * A full month (paidDays == basis) returns the salary unchanged (AC-2); a
 * mid-month joiner pro-rates (AC-3).
 */
export function basePaise(monthlySalaryPaise: number, paidDays: number, daysInBasis: number): number {
  if (daysInBasis <= 0) return 0;
  return roundHalfUp(new Decimal(monthlySalaryPaise).times(paidDays).div(daysInBasis));
}

/**
 * Overtime (FR-4): `otMinutes × ordinaryRatePerMinute × otMultiplier`, half-up,
 * where `ordinaryRatePerMinute = monthlySalary ÷ (otDivisorDays × stdMinutes)`.
 * The rate is NOT pre-rounded — the single half-up happens on the final product
 * (AC-4: 600 min → ₹2,981 = 298,077 paise).
 */
export function overtimePaise(otMinutes: number, monthlySalaryPaise: number, cfg: PayrollConfig): number {
  if (otMinutes <= 0) return 0;
  const divisorMinutes = cfg.otDivisorDays * cfg.standardMinutesPerDay;
  if (divisorMinutes <= 0) return 0;
  const value = new Decimal(monthlySalaryPaise)
    .div(divisorMinutes)
    .times(otMinutes)
    .times(cfg.otMultiplier);
  return roundHalfUp(value);
}

export type NetInput = {
  basePaise: number;
  bonusPaise: number;
  overtimePaise: number;
  deductionPaise: number;
  /** The outstanding advance balance available to recover this run (paise). */
  advanceOutstandingPaise: number;
};

export type NetResult = {
  netPaise: number;
  /** The advance actually recovered — the amount posted to the line + carried. */
  advanceRecoveredPaise: number;
};

/**
 * Net pay with the FR-15 floor ordering:
 *   earnings = base + bonus + overtime
 *   apply the manual/statutory DEDUCTION in full first,
 *   then recover only the AFFORDABLE portion of the advance
 *     (`min(outstanding, remainderAfterDeductions)`),
 *   floor the net at 0 — never a negative disbursement.
 * Returns the recovered amount so the caller can carry the shortfall forward
 * (increment `StaffAdvance.recoveredPaise` by exactly this at finalize).
 */
export function netPaise(input: NetInput): NetResult {
  const earnings = input.basePaise + input.bonusPaise + input.overtimePaise;
  const afterDeduction = earnings - input.deductionPaise;
  const remaining = Math.max(0, afterDeduction);
  const advanceRecoveredPaise = Math.max(0, Math.min(input.advanceOutstandingPaise, remaining));
  return { netPaise: remaining - advanceRecoveredPaise, advanceRecoveredPaise };
}
