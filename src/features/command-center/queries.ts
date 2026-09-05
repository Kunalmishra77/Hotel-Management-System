/**
 * Super-Admin command centre — the multi-property portfolio (FR: multi-property
 * tenancy). One place to see every hotel the caller can access: consolidated KPIs
 * + a per-property row (occupancy/ADR/RevPAR/revenue + its manager). Reuses the
 * canonical analytics/reports layer — no divergent metric math. `report:view-financial`.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { perPropertyStats } from "@/features/analytics/queries";
import { profitReport } from "@/features/reports/queries";
import type { SessionClaims } from "@/lib/auth/claims";

export type PortfolioProperty = {
  id: string;
  name: string;
  code: string;
  city: string;
  occupancyBps: number;
  adrPaise: number;
  revparPaise: number;
  revenuePaise: number;
  managers: string[];
};

export type Portfolio = {
  properties: PortfolioProperty[];
  totals: {
    count: number;
    revenuePaise: number;
    expensePaise: number;
    profitPaise: number;
    occupancyBps: number; // portfolio-weighted
    adrPaise: number;
    revparPaise: number;
  };
};

export async function getPortfolio(user: SessionClaims, monthStart: Date, today: Date): Promise<Portfolio> {
  authorize(user, "report:view-financial", user.activePropertyId);

  // Every accessible property (admin org-wide → all; manager/accounts → assigned).
  // Property is not auto-scoped by the client extension, so filter by the caller's
  // accessible ids explicitly — never a bare findMany (would cross the org boundary).
  const propertyIds = [...user.accessiblePropertyIds];
  if (propertyIds.length === 0) {
    return { properties: [], totals: { count: 0, revenuePaise: 0, expensePaise: 0, profitPaise: 0, occupancyBps: 0, adrPaise: 0, revparPaise: 0 } };
  }
  const props = await db.scoped(user).property.findMany({
    where: { id: { in: propertyIds }, deletedAt: null },
    select: { id: true, name: true, code: true, city: true },
    orderBy: { code: "asc" },
  });

  const [stats, profit, managerRows] = await Promise.all([
    perPropertyStats(user, { propertyIds, from: monthStart, to: today }), // gates report:view-financial
    profitReport(user, { propertyIds, from: monthStart, to: today }),
    // Managers per property — MANAGER assignments whose scope includes the property.
    db.unscoped().roleAssignment.findMany({
      where: { role: "MANAGER", propertyIds: { hasSome: propertyIds } },
      select: { propertyIds: true, user: { select: { name: true } } },
    }),
  ]);

  const statBy = new Map(stats.map((s) => [s.propertyId, s]));
  const mgrBy = new Map<string, string[]>();
  for (const r of managerRows) {
    for (const pid of r.propertyIds) {
      if (!propertyIds.includes(pid)) continue;
      const list = mgrBy.get(pid) ?? [];
      if (r.user?.name) list.push(r.user.name);
      mgrBy.set(pid, list);
    }
  }

  const properties: PortfolioProperty[] = props.map((p) => {
    const s = statBy.get(p.id);
    return {
      id: p.id, name: p.name, code: p.code, city: p.city,
      occupancyBps: s?.occupancyBps ?? 0,
      adrPaise: s?.adrPaise ?? 0,
      revparPaise: s?.revparPaise ?? 0,
      revenuePaise: s?.revenuePaise ?? 0,
      managers: mgrBy.get(p.id) ?? [],
    };
  });

  return {
    properties,
    totals: {
      count: props.length,
      revenuePaise: profit.breakdown.revenuePaise,
      expensePaise: profit.breakdown.expensePaise,
      profitPaise: profit.breakdown.profitPaise,
      occupancyBps: profit.metrics.occupancyBps,
      adrPaise: profit.metrics.adrPaise,
      revparPaise: profit.metrics.revparPaise,
    },
  };
}

export type PortfolioBookingCounts = {
  /** Realised bookings (confirmed / in-house / checked-out) with a check-in in range. */
  bookings: number;
  cancelled: number;
  noShow: number;
  /** (cancelled + no-show) ÷ all bookings, as a percentage. */
  cancelRatePct: number;
};

/**
 * Portfolio booking outcomes over a window — bookings vs cancellations vs no-shows,
 * counted by scheduled check-in date. One grouped count across the caller's
 * accessible properties. `report:view-financial`.
 */
export async function portfolioBookingCounts(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<PortfolioBookingCounts> {
  authorize(user, "report:view-financial", user.activePropertyId);
  if (input.propertyIds.length === 0) return { bookings: 0, cancelled: 0, noShow: 0, cancelRatePct: 0 };
  const groups = await db.scoped(user).reservation.groupBy({
    by: ["status"],
    where: { propertyId: { in: input.propertyIds }, checkInDate: { gte: input.from, lte: input.to } },
    _count: { _all: true },
  });
  const count = (s: string) => groups.find((g) => (g.status as string) === s)?._count._all ?? 0;
  const bookings = count("CONFIRMED") + count("IN_HOUSE") + count("CHECKED_OUT");
  const cancelled = count("CANCELLED");
  const noShow = count("NO_SHOW");
  const denom = bookings + cancelled + noShow;
  return { bookings, cancelled, noShow, cancelRatePct: denom > 0 ? Math.round(((cancelled + noShow) / denom) * 100) : 0 };
}

export type PropertyBookingStat = {
  propertyId: string;
  name: string;
  bookings: number;
  cancelled: number;
  noShow: number;
};

/** Per-property booking outcomes over a window (Super-Admin Bookings section). */
export async function perPropertyBookingCounts(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<PropertyBookingStat[]> {
  authorize(user, "report:view-financial", user.activePropertyId);
  if (input.propertyIds.length === 0) return [];
  const [groups, props] = await Promise.all([
    db.scoped(user).reservation.groupBy({
      by: ["propertyId", "status"],
      where: { propertyId: { in: input.propertyIds }, checkInDate: { gte: input.from, lte: input.to } },
      _count: { _all: true },
    }),
    db.scoped(user).property.findMany({
      where: { id: { in: input.propertyIds }, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);
  const byProp = new Map<string, PropertyBookingStat>();
  for (const p of props) byProp.set(p.id, { propertyId: p.id, name: p.name, bookings: 0, cancelled: 0, noShow: 0 });
  for (const g of groups) {
    const stat = byProp.get(g.propertyId);
    if (!stat) continue;
    const n = g._count._all;
    const s = g.status as string;
    if (s === "CANCELLED") stat.cancelled += n;
    else if (s === "NO_SHOW") stat.noShow += n;
    else if (s === "CONFIRMED" || s === "IN_HOUSE" || s === "CHECKED_OUT") stat.bookings += n;
  }
  return [...byProp.values()];
}

export type PortfolioBookingRow = {
  id: string;
  code: string;
  guestName: string;
  propertyName: string;
  status: string;
  source: string;
  checkInDate: Date;
  checkOutDate: Date;
};

/** The most-recent bookings across every accessible property (newest first). */
export async function recentPortfolioBookings(
  user: SessionClaims,
  input: { propertyIds: string[]; limit?: number },
): Promise<PortfolioBookingRow[]> {
  authorize(user, "report:view-financial", user.activePropertyId);
  if (input.propertyIds.length === 0) return [];
  const rows = await db.scoped(user).reservation.findMany({
    where: { propertyId: { in: input.propertyIds } },
    select: {
      id: true, code: true, status: true, source: true, checkInDate: true, checkOutDate: true,
      guest: { select: { fullName: true } },
      property: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 25,
  });
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    guestName: r.guest?.fullName ?? "—",
    propertyName: r.property?.name ?? "—",
    status: r.status,
    source: r.source,
    checkInDate: r.checkInDate,
    checkOutDate: r.checkOutDate,
  }));
}
