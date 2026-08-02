/**
 * Payroll month/date helpers — pure, deterministic (no `new Date()`; every date
 * is passed in). All calendar dates are the `@db.Date` UTC-midnight instants
 * Prisma returns, so day arithmetic is exact integer-day arithmetic.
 *
 * 21 is the single authority for the pay basis (FR-3): 09 supplies the raw
 * joined/left dates, this module turns them into a day count.
 */
import type { PayrollConfig } from "@/lib/constants/payroll";

const DAY_MS = 86_400_000;

/** Parse a "YYYY-MM" month into its 1-based year/month parts. */
export function parseMonth(month: string): { year: number; month: number } {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) throw new Error(`Invalid payroll month "${month}"`);
  return { year: y, month: m };
}

/** Calendar days in the month (28..31). */
export function daysInMonth(month: string): number {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** UTC-midnight first/last day of the month, matching the `@db.Date` columns. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const { year, month: m } = parseMonth(month);
  return { start: new Date(Date.UTC(year, m - 1, 1)), end: new Date(Date.UTC(year, m, 0)) };
}

/** The pay-basis denominator (FR-3): calendar days, or the pinned config value. */
export function daysInBasis(month: string, cfg: PayrollConfig): number {
  return cfg.dayBasis === "calendar" ? daysInMonth(month) : cfg.dayBasis;
}

/** Whole-day count between two UTC-midnight dates, inclusive of both ends. */
export function inclusiveDaySpan(start: Date, end: Date): number {
  if (end.getTime() < start.getTime()) return 0;
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

/** True when `a` is the same UTC calendar day as `b`. */
export function isSameDay(a: Date, b: Date): boolean {
  return Math.floor(a.getTime() / DAY_MS) === Math.floor(b.getTime() / DAY_MS);
}
