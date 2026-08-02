/**
 * Analytics queries — 14 T-12/T-15/T-16/T-17 (FR-2/3/12/13/14/15, AC-3/5/6/13/14).
 * Live tiles (permission-filtered server-side), trends from snapshots, and live
 * segments. Callers pass claims; consolidation is scoped to the caller's props.
 */
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { occupancy } from "./domain/metrics";
import { dayBounds } from "./internal";
import type { SessionClaims } from "@/lib/auth/claims";

export type LiveTiles = {
  rooms: { vacant: number; occupied: number; reserved: number; maintenance: number; housekeeping: number };
  occupancyBps: number;
  arrivalsToday: number;
  departuresToday: number;
  /** Financial tiles — null when the caller lacks report:view-financial (AC-6). */
  revenueTodayPaise: number | null;
  expenseTodayPaise: number | null;
  pendingPaise: number | null;
};

export async function liveTiles(user: SessionClaims, propertyIds: string[]): Promise<LiveTiles> {
  const scoped = db.scoped(user);
  const canSeeMoney = hasPermission(user, "report:view-financial");
  const { start, next } = dayBounds(new Date());
  const where = { propertyId: { in: propertyIds } };

  const [roomGroups, arrivalsToday, departuresToday] = await Promise.all([
    scoped.room.groupBy({ by: ["status"], where: { ...where, isActive: true }, _count: { _all: true } }),
    scoped.reservation.count({ where: { ...where, status: "CONFIRMED", checkInDate: { gte: start, lt: next } } }),
    scoped.reservation.count({ where: { ...where, status: "IN_HOUSE", checkOutDate: { gte: start, lt: next } } }),
  ]);

  const count = (s: string) => roomGroups.find((g) => g.status === s)?._count._all ?? 0;
  const rooms = { vacant: count("VACANT"), occupied: count("OCCUPIED"), reserved: count("RESERVED"), maintenance: count("UNDER_MAINTENANCE"), housekeeping: count("HOUSEKEEPING") };
  const sellable = rooms.vacant + rooms.occupied + rooms.reserved + rooms.housekeeping; // active minus maintenance
  const occupancyBps = occupancy(sellable, rooms.occupied); // live point-in-time (reporting.md (b))

  let revenueTodayPaise: number | null = null;
  let expenseTodayPaise: number | null = null;
  let pendingPaise: number | null = null;
  if (canSeeMoney) {
    const [rev, exp, charges, payments] = await Promise.all([
      scoped.folioLine.aggregate({ where: { folio: { propertyId: { in: propertyIds } }, businessDate: { gte: start, lt: next }, type: { notIn: ["TAX"] } }, _sum: { amountPaise: true } }),
      scoped.expense.aggregate({ where: { ...where, status: "APPROVED", spentOn: { gte: start, lt: next } }, _sum: { amountPaise: true } }),
      scoped.folioLine.aggregate({ where: { folio: { propertyId: { in: propertyIds } } }, _sum: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }),
      scoped.payment.aggregate({ where: { ...where }, _sum: { amountPaise: true } }),
    ]);
    revenueTodayPaise = Number(rev._sum.amountPaise ?? 0n);
    expenseTodayPaise = Number(exp._sum.amountPaise ?? 0);
    // Net outstanding ≈ Σ(line + tax) − Σ(non-refund − refund). Refunds are rare;
    // for a live tile this aggregate is the pending-balance figure.
    const chargeTotal = Number(charges._sum.amountPaise ?? 0n) + (charges._sum.cgstPaise ?? 0) + (charges._sum.sgstPaise ?? 0) + (charges._sum.igstPaise ?? 0);
    pendingPaise = Math.max(0, chargeTotal - Number(payments._sum.amountPaise ?? 0n));
  }

  return { rooms, occupancyBps, arrivalsToday, departuresToday, revenueTodayPaise, expenseTodayPaise, pendingPaise };
}

/** Daily trend from immutable snapshots (closed dates) for a metric (FR-3/12, AC-13). */
export async function trend(
  user: SessionClaims,
  input: { metric: "occupancy" | "revenue" | "adr" | "revpar"; from: Date; to: Date; propertyIds: string[] },
): Promise<{ businessDate: string; value: number }[]> {
  const rows = await db.scoped(user).dailyStatSnapshot.findMany({
    where: { propertyId: { in: input.propertyIds }, businessDate: { gte: input.from, lte: input.to } },
    select: { businessDate: true, occupancyBps: true, totalRevenuePaise: true, adrPaise: true, revparPaise: true },
    orderBy: { businessDate: "asc" },
  });
  return rows.map((r) => ({
    businessDate: r.businessDate.toISOString().slice(0, 10),
    value:
      input.metric === "occupancy" ? r.occupancyBps
      : input.metric === "revenue" ? Number(r.totalRevenuePaise)
      : input.metric === "adr" ? r.adrPaise
      : r.revparPaise,
  }));
}

export type Segment = { id: string; name: string; revenuePaise: number; roomNights: number };

/** Top corporates by revenue + room-nights over the range, live (FR-13, AC-14). */
export async function segments(
  user: SessionClaims,
  input: { from: Date; to: Date; propertyIds: string[] },
): Promise<{ corporates: Segment[] }> {
  const scoped = db.scoped(user);
  const reservations = await scoped.reservation.findMany({
    where: { propertyId: { in: input.propertyIds }, corporateId: { not: null }, checkInDate: { gte: input.from, lte: input.to }, status: { in: ["IN_HOUSE", "CHECKED_OUT"] } },
    select: { corporateId: true, nights: true, corporate: { select: { name: true } }, folio: { select: { lines: { select: { amountPaise: true, type: true } } } } },
  });

  const byCorp = new Map<string, Segment>();
  for (const r of reservations) {
    if (!r.corporateId) continue;
    const seg = byCorp.get(r.corporateId) ?? { id: r.corporateId, name: r.corporate?.name ?? "?", revenuePaise: 0, roomNights: 0 };
    seg.roomNights += r.nights;
    for (const l of r.folio?.lines ?? []) if (l.type !== "TAX") seg.revenuePaise += Number(l.amountPaise);
    byCorp.set(r.corporateId, seg);
  }
  const corporates = [...byCorp.values()].sort((a, b) => b.revenuePaise - a.revenuePaise);
  return { corporates };
}
