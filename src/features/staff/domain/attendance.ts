/**
 * Attendance + monthly-summary domain — 09 T-3/T-4 (FR-4/6, AC-5/7/9).
 * Pure. `workedMinutes` is instant-based, so an overnight shift (check-out on the
 * next calendar day) is handled naturally; a check-out at/ before check-in is
 * invalid and the action rejects it (AC-6).
 */
export function workedMinutes(checkInAt: Date, checkOutAt: Date): number {
  const ms = checkOutAt.getTime() - checkInAt.getTime();
  return ms > 0 ? Math.round(ms / 60_000) : 0;
}

export type SummaryAttendance = {
  day: Date;
  isLeave: boolean;
  workedMinutes: number | null;
  overtimeMinutes: number;
};

export type MonthlySummary = {
  employedDays: number;
  workedDays: number;
  leaveDays: number;
  overtimeMinutes: number;
};

/** Days in a "YYYY-MM" month. */
function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
function dayNum(d: Date): number {
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86_400_000);
}

/**
 * Headcount/cost context for 08/14 (FR-6). `employedDays` is the overlap of the
 * staff's employment window with the month — NON-authoritative; 21 owns the
 * pay-basis definition and derives its own from the raw per-day feed.
 */
export function monthlySummary(
  attendance: SummaryAttendance[],
  month: string,
  staff: { joinedOn: Date; leftOn: Date | null },
): MonthlySummary {
  const [y, m] = month.split("-").map(Number);
  const monthStart = dayNum(new Date(Date.UTC(y!, m! - 1, 1)));
  const monthEnd = dayNum(new Date(Date.UTC(y!, m! - 1, daysInMonth(month))));

  const joined = dayNum(staff.joinedOn);
  const left = staff.leftOn ? dayNum(staff.leftOn) : monthEnd;
  const from = Math.max(monthStart, joined);
  const to = Math.min(monthEnd, left);
  const employedDays = to >= from ? to - from + 1 : 0;

  let workedDays = 0;
  let leaveDays = 0;
  let overtimeMinutes = 0;
  for (const a of attendance) {
    if (a.isLeave) leaveDays += 1;
    else if ((a.workedMinutes ?? 0) > 0) workedDays += 1;
    overtimeMinutes += a.overtimeMinutes;
  }
  return { employedDays, workedDays, leaveDays, overtimeMinutes };
}
