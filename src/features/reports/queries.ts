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
  // Revenue by category (06), merged across the scoped properties. Fan the
  // per-property reads out concurrently — a portfolio (command centre/owner) has
  // several properties and serial awaits made this an N-round-trip bottleneck.
  const perProperty = await Promise.all(
    input.propertyIds.map((propertyId) => revenue06(user, { propertyId, from: input.from, to: input.to })),
  );
  const revenueByCategory: Record<string, number> = {};
  for (const r of perProperty) {
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

// ---------------------------------------------------------------------------
// #28 — additional property-wise report shards: bookings, rooms, GST.
// Each returns rows keyed by propertyId; the page maps names + totals. All reads
// are property-scoped; `report:view-financial` gates them like the others.
// ---------------------------------------------------------------------------

export type BookingsReportRow = {
  propertyId: string;
  total: number; confirmed: number; inHouse: number; checkedOut: number; cancelled: number; noShow: number; enquiry: number;
  roomNights: number;
};

/** Bookings for the period (by check-in date) grouped per property + by status. */
export async function bookingsReport(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<BookingsReportRow[]> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null);
  const rows = await db.scoped(user).reservation.findMany({
    where: { propertyId: { in: input.propertyIds }, checkInDate: { gte: input.from, lte: input.to } },
    select: { propertyId: true, status: true, nights: true },
  });
  const map = new Map<string, BookingsReportRow>();
  for (const pid of input.propertyIds) {
    map.set(pid, { propertyId: pid, total: 0, confirmed: 0, inHouse: 0, checkedOut: 0, cancelled: 0, noShow: 0, enquiry: 0, roomNights: 0 });
  }
  for (const r of rows) {
    const row = map.get(r.propertyId);
    if (!row) continue;
    row.total += 1;
    if (r.status === "CONFIRMED") row.confirmed += 1;
    else if (r.status === "IN_HOUSE") row.inHouse += 1;
    else if (r.status === "CHECKED_OUT") row.checkedOut += 1;
    else if (r.status === "CANCELLED") row.cancelled += 1;
    else if (r.status === "NO_SHOW") row.noShow += 1;
    else if (r.status === "ENQUIRY") row.enquiry += 1;
    // Room-nights count only non-cancelled stays (business-rules §Availability).
    if (r.status === "IN_HOUSE" || r.status === "CHECKED_OUT" || r.status === "CONFIRMED") row.roomNights += r.nights;
  }
  return [...map.values()];
}

export type RoomsReportRow = {
  propertyId: string;
  total: number; active: number; vacant: number; occupied: number; reserved: number; maintenance: number; housekeeping: number;
};

/** Current room inventory per property, by status (the room-board rollup). */
export async function roomsReport(
  user: SessionClaims,
  input: { propertyIds: string[] },
): Promise<RoomsReportRow[]> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null);
  // Only real (active) rooms — inactive/demo rooms must not inflate the inventory.
  const rooms = await db.scoped(user).room.findMany({
    where: { propertyId: { in: input.propertyIds }, isActive: true },
    select: { propertyId: true, status: true, isActive: true },
  });
  const map = new Map<string, RoomsReportRow>();
  for (const pid of input.propertyIds) {
    map.set(pid, { propertyId: pid, total: 0, active: 0, vacant: 0, occupied: 0, reserved: 0, maintenance: 0, housekeeping: 0 });
  }
  for (const r of rooms) {
    const row = map.get(r.propertyId);
    if (!row) continue;
    row.total += 1;
    if (r.isActive) row.active += 1;
    if (r.status === "VACANT") row.vacant += 1;
    else if (r.status === "OCCUPIED") row.occupied += 1;
    else if (r.status === "RESERVED") row.reserved += 1;
    else if (r.status === "UNDER_MAINTENANCE") row.maintenance += 1;
    else if (r.status === "HOUSEKEEPING") row.housekeeping += 1;
  }
  return [...map.values()];
}

export type GstReportRow = {
  propertyId: string;
  taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; invoiceCount: number;
};

/** GST collected per property for the period, from issued invoices. Credit notes
 *  carry negative amounts so they net the originals out automatically. */
export async function gstReport(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<GstReportRow[]> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null);
  const invoices = await db.scoped(user).invoice.findMany({
    where: { propertyId: { in: input.propertyIds }, issuedAt: { gte: input.from, lte: input.to } },
    select: { propertyId: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true, type: true },
  });
  const map = new Map<string, GstReportRow>();
  for (const pid of input.propertyIds) {
    map.set(pid, { propertyId: pid, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0, invoiceCount: 0 });
  }
  for (const i of invoices) {
    const row = map.get(i.propertyId);
    if (!row) continue;
    row.taxablePaise += Number(i.taxableValuePaise);
    row.cgstPaise += i.cgstPaise;
    row.sgstPaise += i.sgstPaise;
    row.igstPaise += i.igstPaise;
    row.totalPaise += Number(i.totalPaise);
    if (i.type === "TAX_INVOICE") row.invoiceCount += 1;
  }
  return [...map.values()];
}
