/**
 * employedDays + eligibility — 21 T-3/T-7 (FR-3/11, AC-1/3/17).
 *
 * 21 is the SINGLE authority for `employedDays` (FR-3): the number of calendar
 * days in the month a staff member is actually employed, from
 * `max(monthStart, joinedOn)` to `min(monthEnd, leftOn ?? monthEnd)`. 09 only
 * supplies the raw dates — it never computes the pay basis. Pure & deterministic;
 * `tz` is accepted for the property-local intent but the dates are already
 * date-only (`@db.Date`), so the count is timezone-stable.
 */
import { inclusiveDaySpan, monthBounds } from "./dates";

export type EmploymentWindow = {
  joinedOn: Date;
  leftOn: Date | null;
  isActive?: boolean;
};

/**
 * Calendar days employed within `month`. Zero when the employment window does
 * not overlap the month at all (joined after month-end, or left before
 * month-start) — which is what makes a joiner/leaver pro-rate correctly (AC-3).
 */
export function employedDays(
  month: string,
  joinedOn: Date,
  leftOn: Date | null,
  _tz?: string,
): number {
  const { start, end } = monthBounds(month);

  // No overlap → not employed this month.
  if (joinedOn.getTime() > end.getTime()) return 0;
  if (leftOn && leftOn.getTime() < start.getTime()) return 0;

  const effectiveStart = joinedOn.getTime() > start.getTime() ? joinedOn : start;
  const effectiveEnd = leftOn && leftOn.getTime() < end.getTime() ? leftOn : end;

  return inclusiveDaySpan(effectiveStart, effectiveEnd);
}

/**
 * Eligible for the run iff the employment window overlaps the month (FR-11).
 * A staff member who joined after the month, or left before it, has zero
 * employed days and is excluded (S-EX in the fixtures). deletedAt exclusion is
 * enforced upstream by 09 `getStaffForPayroll`; this is the date-window gate.
 */
export function isEligible(staff: EmploymentWindow, month: string): boolean {
  return employedDays(month, staff.joinedOn, staff.leftOn) > 0;
}
