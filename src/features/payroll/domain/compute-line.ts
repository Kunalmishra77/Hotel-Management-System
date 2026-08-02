/**
 * Line computation orchestrator — 21 (FR-2/3/4/5/15). Pure: composes
 * employedDays → lopDays → paidDays → base/overtime → net into one deterministic
 * result the action persists. Overrides (FR-13) replace the derived base/OT.
 */
import type { PayrollConfig } from "@/lib/constants/payroll";
import { daysInBasis } from "./dates";
import { employedDays } from "./employed-days";
import { lopDays, paidDays, totalOvertimeMinutes, type AttendanceDay } from "./lop";
import { basePaise, netPaise, overtimePaise } from "./pay";

export type ComputeLineInput = {
  month: string;
  monthlySalaryPaise: number;
  joinedOn: Date;
  leftOn: Date | null;
  attendance: AttendanceDay[];
  cfg: PayrollConfig;
  /** Editable components (default 0 on generate; user-set on adjust). */
  bonusPaise?: number;
  deductionPaise?: number;
  /** Outstanding advance available to recover (seeded from StaffAdvance). */
  advanceOutstandingPaise?: number;
  /** FR-13 overrides — replace the derived value when present. */
  overrideBasePaise?: number | null;
  overrideOvertimePaise?: number | null;
  tz?: string;
};

export type ComputedLine = {
  employedDays: number;
  lopDays: number;
  paidDays: number;
  otMinutes: number;
  basePaise: number;
  overtimePaise: number;
  bonusPaise: number;
  deductionPaise: number;
  /** The advance actually recovered (posted to the line as advancePaise). */
  advancePaise: number;
  netPaise: number;
};

export function computeLine(input: ComputeLineInput): ComputedLine {
  const cfg = input.cfg;
  const basis = daysInBasis(input.month, cfg);

  const employed = employedDays(input.month, input.joinedOn, input.leftOn, input.tz);
  const lop = lopDays(input.attendance, employed, cfg);
  const paid = paidDays(employed, lop, basis);

  const derivedBase = basePaise(input.monthlySalaryPaise, paid, basis);
  const otMinutes = totalOvertimeMinutes(input.attendance);
  const derivedOt = overtimePaise(otMinutes, input.monthlySalaryPaise, cfg);

  const base = input.overrideBasePaise ?? derivedBase;
  const ot = input.overrideOvertimePaise ?? derivedOt;
  const bonus = input.bonusPaise ?? 0;
  const deduction = input.deductionPaise ?? 0;

  const { netPaise: net, advanceRecoveredPaise } = netPaise({
    basePaise: base,
    bonusPaise: bonus,
    overtimePaise: ot,
    deductionPaise: deduction,
    advanceOutstandingPaise: input.advanceOutstandingPaise ?? 0,
  });

  return {
    employedDays: employed,
    lopDays: lop,
    paidDays: paid,
    otMinutes,
    basePaise: base,
    overtimePaise: ot,
    bonusPaise: bonus,
    deductionPaise: deduction,
    advancePaise: advanceRecoveredPaise,
    netPaise: net,
  };
}
