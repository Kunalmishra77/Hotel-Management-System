/**
 * Payroll — public surface (21).
 *
 * The cross-module contract 08-profit-reports depends on is the finalized staff
 * cost: it MUST come from payroll, NEVER from a 07 STAFF-head expense (counted
 * once, reporting.md). This file keeps that surface small and free of any
 * "use server" import so a query module (08) can pull it without dragging in
 * server actions. The run screens import `./actions` and `./queries` directly.
 */
import { db } from "@/lib/db";

/**
 * Finalized payroll net for a property set in a "YYYY-MM" month (paise). Only
 * FINALIZED runs count; a month with no finalized run contributes 0.
 *
 * NOTE: signature is load-bearing — 08 calls `getFinalizedStaffCost(propertyIds,
 * month)` with a month string. Do NOT change it. A range variant is a SEPARATE
 * export below.
 */
export async function getFinalizedStaffCost(propertyIds: string[], month: string): Promise<number> {
  const agg = await db.unscoped().payrollRun.aggregate({
    where: { propertyId: { in: propertyIds }, month, status: "FINALIZED" },
    _sum: { netTotalPaise: true },
  });
  return Number(agg._sum.netTotalPaise ?? 0n);
}

/** The "YYYY-MM" months (inclusive) spanned by [from, to], by calendar month. */
export function monthsInRange(from: Date, to: Date): string[] {
  const months: string[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth(); // 0-based
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth();
  while (y < endY || (y === endY && m <= endM)) {
    months.push(`${y}-${String(m + 1).padStart(2, "0")}`);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return months;
}

/**
 * Finalized payroll net across a DATE RANGE (paise) — the range variant 08 uses
 * when a report spans multiple months. Sums finalized `netTotalPaise` for every
 * `(property, month)` whose month falls in [from, to]. Separate from the month
 * signature above (which stays stable for 08's existing call site).
 */
export async function getFinalizedStaffCostInRange(
  propertyIds: string[],
  from: Date,
  to: Date,
): Promise<number> {
  const months = monthsInRange(from, to);
  if (months.length === 0) return 0;
  const agg = await db.unscoped().payrollRun.aggregate({
    where: { propertyId: { in: propertyIds }, month: { in: months }, status: "FINALIZED" },
    _sum: { netTotalPaise: true },
  });
  return Number(agg._sum.netTotalPaise ?? 0n);
}
