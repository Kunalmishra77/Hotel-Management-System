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
