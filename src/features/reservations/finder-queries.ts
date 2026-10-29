/**
 * Bookings finder query — the filterable bookings list behind the Bookings pages.
 * Filters run in the DB (not on the last 30 rows), so "arriving this week" or
 * "departing today across all hotels" covers every booking. Property-scoped:
 * only properties the caller can access are ever queried. Re-exported from
 * queries.ts (the module's public surface).
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";
import type { Prisma } from "@prisma/client";
import { addDays, type FinderParams } from "./domain/finder";

export type BookingFinderRow = {
  id: string;
  code: string;
  guestName: string;
  propertyId: string;
  propertyName: string;
  status: string;
  source: string;
  checkInDate: Date;
  checkOutDate: Date;
  nights: number;
  roomNumbers: string[];
  bookedOn: Date;
  needsAttention: string | null;
};

export type BookingFinderResult = {
  rows: BookingFinderRow[];
  /** Per-status counts for the CURRENT property + date filter (status ignored), for the chips. */
  statusCounts: Record<string, number>;
  /** More matches exist than were returned — narrow the filter. */
  truncated: boolean;
};

const LIMIT = 300;

/** UTC instant of 00:00 on a property-local calendar day. */
function localDayStartUtc(iso: string, timeZone: string): Date {
  const asUtc = new Date(`${iso}T00:00:00.000Z`);
  const local = new Date(asUtc.toLocaleString("en-US", { timeZone }));
  const utcNaive = new Date(asUtc.toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(asUtc.getTime() - (local.getTime() - utcNaive.getTime()));
}

function dateWhere(p: FinderParams, timeZone: string): Prisma.ReservationWhereInput {
  if (!p.from && !p.to) return {};
  // @db.Date columns hold the calendar day at UTC midnight.
  const f = p.from ? new Date(`${p.from}T00:00:00.000Z`) : undefined;
  const t = p.to ? new Date(`${p.to}T00:00:00.000Z`) : undefined;
  const range = { ...(f ? { gte: f } : {}), ...(t ? { lte: t } : {}) };
  switch (p.dateField) {
    case "arrival":
      return { checkInDate: range };
    case "departure":
      return { checkOutDate: range };
    case "stay":
      // In the property on any night of the window: arrived by `to`, leaves after `from`.
      return { ...(t ? { checkInDate: { lte: t } } : {}), ...(f ? { checkOutDate: { gt: f } } : {}) };
    case "booked":
      // createdAt is a UTC instant — bound it by the property-local calendar day.
      return {
        createdAt: {
          ...(p.from ? { gte: localDayStartUtc(p.from, timeZone) } : {}),
          ...(p.to ? { lt: localDayStartUtc(addDays(p.to, 1), timeZone) } : {}),
        },
      };
  }
}

const ORDER: Record<FinderParams["sort"], Prisma.ReservationOrderByWithRelationInput[]> = {
  newest: [{ createdAt: "desc" }],
  arrival: [{ checkInDate: "asc" }, { createdAt: "desc" }],
  departure: [{ checkOutDate: "asc" }, { createdAt: "desc" }],
  guest: [{ guest: { fullName: "asc" } }, { checkInDate: "desc" }],
};

export async function findBookings(
  user: SessionClaims,
  p: FinderParams,
  opts: { timeZone?: string } = {},
): Promise<BookingFinderResult> {
  const accessible = [...user.accessiblePropertyIds];
  const propertyIds = p.prop === "all" ? accessible : accessible.filter((id) => id === p.prop);
  authorize(user, "reservation:view", propertyIds.length === 1 ? propertyIds[0] : user.activePropertyId);
  if (propertyIds.length === 0) return { rows: [], statusCounts: {}, truncated: false };

  const scoped = db.scoped(user);
  const base: Prisma.ReservationWhereInput = { propertyId: { in: propertyIds }, ...dateWhere(p, opts.timeZone ?? "Asia/Kolkata") };
  const statusWhere: Prisma.ReservationWhereInput =
    p.status === "ATTENTION" ? { needsAttention: { not: null } } : p.status ? { status: p.status } : {};

  const [rows, groups, attention] = await Promise.all([
    scoped.reservation.findMany({
      where: { ...base, ...statusWhere },
      select: {
        id: true, code: true, status: true, source: true, checkInDate: true, checkOutDate: true, nights: true,
        createdAt: true, needsAttention: true, propertyId: true,
        guest: { select: { fullName: true } },
        property: { select: { name: true } },
        allocations: { select: { room: { select: { number: true } } } },
      },
      orderBy: ORDER[p.sort],
      take: LIMIT + 1,
    }),
    scoped.reservation.groupBy({ by: ["status"], where: base, _count: { _all: true } }),
    scoped.reservation.count({ where: { ...base, needsAttention: { not: null } } }),
  ]);

  const statusCounts: Record<string, number> = { ATTENTION: attention };
  for (const g of groups) statusCounts[g.status] = g._count._all;
  return {
    truncated: rows.length > LIMIT,
    statusCounts,
    rows: rows.slice(0, LIMIT).map((r) => ({
      id: r.id,
      code: r.code,
      guestName: r.guest?.fullName ?? "—",
      propertyId: r.propertyId,
      propertyName: r.property?.name ?? "—",
      status: r.status,
      source: r.source,
      checkInDate: r.checkInDate,
      checkOutDate: r.checkOutDate,
      nights: r.nights,
      roomNumbers: r.allocations.map((a) => a.room.number),
      bookedOn: r.createdAt,
      needsAttention: r.needsAttention,
    })),
  };
}
