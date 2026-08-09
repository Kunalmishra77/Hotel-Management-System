/**
 * Profit-report queries — 08 T-2..T-5 (FR-1..6/8, AC-1..6). `report:view-financial`.
 * NO owned tables + NO divergent math: reuses 06 revenue, 07 expenses, 14's
 * metric library + snapshots, and 21's finalized staff cost — assembled with the
 * pure `incomeVsExpense`. Staff cost is added exactly once, from payroll.
 */
import { authorize } from "@/lib/permissions";
import { db } from "@/lib/db";
import { revenueByCategory as revenue06 } from "@/features/billing/queries";
import { expenseRollup } from "@/features/expenses/queries";
import { getFinalizedStaffCost } from "@/features/payroll";
import { occupancy, adr, revpar } from "@/features/analytics/domain/metrics";
import { segments as analyticsSegments, type Segment } from "@/features/analytics/queries";
import { apportionStaffCost, incomeVsExpense, type Breakdown } from "./domain/profit";
import type { SessionClaims } from "@/lib/auth/claims";

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}
function rangeDaysInclusive(from: Date, to: Date): number {
  const a = Math.round(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) / 86_400_000);
  const b = Math.round(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) / 86_400_000);
  return Math.max(1, b - a + 1);
}

export type ProfitReport = {
  breakdown: Breakdown;
  metrics: { occupancyBps: number; adrPaise: number; revparPaise: number };
};

export async function profitReport(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<ProfitReport> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null); // FR-7/8
  return computeProfitReport(user, input);
}

/**
 * Unguarded profit computation — the SAME canonical numbers as `profitReport`,
 * without the `report:view-financial` gate. Callers MUST authorize first with an
 * appropriate permission: `profitReport` uses `report:view-financial`; the owner
 * portal (27) uses `owner:view-financials` scoped to the owner's property. Reads
 * are still property-scoped via `db.scoped(user)`, so this cannot widen access.
 */
export async function computeProfitReport(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<ProfitReport> {
  // Revenue by category (06), merged across the scoped properties.
  const revenueByCategory: Record<string, number> = {};
  for (const propertyId of input.propertyIds) {
    const r = await revenue06(user, { propertyId, from: input.from, to: input.to });
    for (const [cat, paise] of Object.entries(r)) revenueByCategory[cat] = (revenueByCategory[cat] ?? 0) + paise;
  }

  // Expenses by head (07, approved, excl. STAFF salary by construction).
  const { totals: expenseByHead } = await expenseRollup(user, { propertyIds: input.propertyIds, from: input.from, to: input.to, groupBy: "head" });

  // Staff cost (21) — finalized payroll net, apportioned across the range (once).
  const month = input.from.toISOString().slice(0, 7);
  const monthlyNet = await getFinalizedStaffCost(input.propertyIds, month);
  const staffCost = apportionStaffCost(monthlyNet, daysInMonth(month), rangeDaysInclusive(input.from, input.to));

  const breakdown = incomeVsExpense(revenueByCategory, expenseByHead, staffCost);

  // Metrics from immutable snapshots over the range (14 definitions).
  const snaps = await db.scoped(user).dailyStatSnapshot.aggregate({
    where: { propertyId: { in: input.propertyIds }, businessDate: { gte: input.from, lte: input.to } },
    _sum: { availableRoomNights: true, occupiedRoomNights: true, roomRevenuePaise: true },
  });
  const availRN = snaps._sum.availableRoomNights ?? 0;
  const occRN = snaps._sum.occupiedRoomNights ?? 0;
  const roomRev = Number(snaps._sum.roomRevenuePaise ?? 0n);
  const metrics = { occupancyBps: occupancy(availRN, occRN), adrPaise: adr(roomRev, occRN), revparPaise: revpar(roomRev, availRN) };

  return { breakdown, metrics };
}

export type RevenueSegments = { corporates: Segment[]; bySource: { source: string; revenuePaise: number }[] };

/** Revenue by booking source + corporate (FR-5, AC-5). */
export async function revenueSegments(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<RevenueSegments> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null);

  const { corporates } = await analyticsSegments(user, input);

  // By booking source: sum folio revenue (tax-excluded) grouped by reservation source.
  const reservations = await db.scoped(user).reservation.findMany({
    where: { propertyId: { in: input.propertyIds }, checkInDate: { gte: input.from, lte: input.to }, status: { in: ["IN_HOUSE", "CHECKED_OUT"] } },
    select: { source: true, folio: { select: { lines: { select: { amountPaise: true, type: true } } } } },
  });
  const bySourceMap = new Map<string, number>();
  for (const r of reservations) {
    let rev = 0;
    for (const l of r.folio?.lines ?? []) if (l.type !== "TAX") rev += Number(l.amountPaise);
    bySourceMap.set(r.source, (bySourceMap.get(r.source) ?? 0) + rev);
  }
  const bySource = [...bySourceMap.entries()].map(([source, revenuePaise]) => ({ source, revenuePaise })).sort((a, b) => b.revenuePaise - a.revenuePaise);

  return { corporates, bySource };
}
