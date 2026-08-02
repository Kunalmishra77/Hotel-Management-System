/**
 * Corporate CRM queries — 25 T-6/T-10/T-11/T-12 (FR-2/4/5/6/7, AC-2/5/6/7/8).
 *
 * `getNegotiatedRate` is a Tier-1 service (no session — 03/23 call it deep in
 * rate resolution). The reporting queries gate on `report:view-financial` and
 * derive figures the SAME way 06/14 do (non-tax, net-of-discount folio lines via
 * the scoped reservation relation) so they reconcile to the paisa. The
 * authoritative receivable is always 06's cached `Corporate.receivablePaise`.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { availableCredit } from "./domain/available-credit";
import { aging, type AgingCharge } from "./domain/aging";
import { commissionOnRevenue } from "./domain/commission";
import type { SessionClaims } from "@/lib/auth/claims";

const IN_STAY = ["IN_HOUSE", "CHECKED_OUT"] as const;

/**
 * A corporate's negotiated rate for a category, in paise, or null (FR-4, AC-2).
 * 03/23 pass the result into `24.resolveRate({…, negotiatedRatePaise})`, where it
 * wins the chain. No session: this is master-data resolved during booking, keyed
 * by the (already-scoped) corporateId on the reservation.
 */
export async function getNegotiatedRate(
  corporateId: string,
  roomCategoryId: string,
): Promise<number | null> {
  const row = await db.unscoped().negotiatedRate.findUnique({
    where: { corporateId_roomCategoryId: { corporateId, roomCategoryId } },
    select: { ratePaise: true },
  });
  return row?.ratePaise ?? null;
}

// ── List (master-data management screen) ────────────────────────────────────

export type CorporateListItem = {
  id: string;
  name: string;
  gstin: string | null;
  creditLimitPaise: number;
  receivablePaise: number;
  availableCreditPaise: number;
  negotiatedRates: { roomCategoryId: string; ratePaise: number }[];
};

/** All corporates in the org with their credit position (FR-1). `corporate:manage`. */
export async function listCorporates(user: SessionClaims): Promise<CorporateListItem[]> {
  authorize(user, "corporate:manage", null);
  const rows = await db.unscoped().corporate.findMany({
    where: { orgId: user.orgId },
    select: {
      id: true, name: true, gstin: true, creditLimitPaise: true, receivablePaise: true,
      negotiatedRates: { select: { roomCategoryId: true, ratePaise: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    gstin: c.gstin,
    creditLimitPaise: Number(c.creditLimitPaise),
    receivablePaise: Number(c.receivablePaise),
    availableCreditPaise: Number(availableCredit(BigInt(c.creditLimitPaise), BigInt(c.receivablePaise))),
    negotiatedRates: c.negotiatedRates,
  }));
}

export type AgentListItem = { id: string; name: string; commissionBps: number; contactPhone: string | null };

/** All travel agents in the org (FR-1). `corporate:manage`. */
export async function listAgents(user: SessionClaims): Promise<AgentListItem[]> {
  authorize(user, "corporate:manage", null);
  return db.unscoped().travelAgent.findMany({
    where: { orgId: user.orgId },
    select: { id: true, name: true, commissionBps: true, contactPhone: true },
    orderBy: { name: "asc" },
  });
}

// ── Account statement (FR-2/7, AC-7) ────────────────────────────────────────

export type StatementCharge = {
  folioId: string;
  reservationCode: string;
  date: Date;
  amountPaise: number;
};

export type CorporateStatement = {
  corporateId: string;
  name: string;
  gstin: string | null;
  creditLimitPaise: number;
  /** Authoritative cached receivable — 06 owns this write. */
  receivablePaise: number;
  availableCreditPaise: number;
  /** CORPORATE_CREDIT settlements attributed to this corporate (charges to the account). */
  charges: StatementCharge[];
  /** Amount cleared against the account (Σ charges − receivable), never negative. */
  paidPaise: number;
  aging: { current: number; days31to60: number; days61to90: number; days90plus: number; totalPaise: number };
};

/**
 * The corporate account statement (AC-7): balance from 06's cached receivable,
 * charges built from the CORPORATE_CREDIT settlements on this corporate's
 * (scoped) reservations, and aging derived by the pure `aging` domain fn.
 * Exportable via 15 (the export wiring is a documented follow-up).
 */
export async function corporateStatement(
  user: SessionClaims,
  input: { corporateId: string; asOf?: Date },
): Promise<CorporateStatement | null> {
  authorize(user, "report:view-financial", null); // AC-8

  const corp = await db.unscoped().corporate.findFirst({
    where: { id: input.corporateId, orgId: user.orgId },
    select: { id: true, name: true, gstin: true, creditLimitPaise: true, receivablePaise: true },
  });
  if (!corp) return null;

  // CORPORATE_CREDIT payments = charges to the corporate account. Read through
  // the SCOPED reservation relation (the same read path 14/analytics uses).
  const reservations = await db.scoped(user).reservation.findMany({
    where: { corporateId: input.corporateId },
    select: {
      code: true,
      folio: {
        select: {
          id: true,
          payments: {
            where: { mode: "CORPORATE_CREDIT", isRefund: false },
            select: { amountPaise: true, receivedAt: true },
          },
        },
      },
    },
  });

  const charges: StatementCharge[] = [];
  let totalCharges = 0n;
  for (const r of reservations) {
    const folioId = r.folio?.id;
    if (!folioId) continue;
    for (const p of r.folio?.payments ?? []) {
      charges.push({ folioId, reservationCode: r.code, date: p.receivedAt, amountPaise: Number(p.amountPaise) });
      totalCharges += BigInt(p.amountPaise);
    }
  }
  charges.sort((a, b) => a.date.getTime() - b.date.getTime());

  const receivable = BigInt(corp.receivablePaise);
  // What's been cleared (via releaseCredit / corporate payments) = charges − balance.
  const paid = totalCharges > receivable ? totalCharges - receivable : 0n;

  const agingCharges: AgingCharge[] = charges.map((c) => ({ amountPaise: BigInt(c.amountPaise), date: c.date }));
  const buckets = aging(agingCharges, paid, input.asOf ?? new Date());

  return {
    corporateId: corp.id,
    name: corp.name,
    gstin: corp.gstin,
    creditLimitPaise: Number(corp.creditLimitPaise),
    receivablePaise: Number(corp.receivablePaise),
    availableCreditPaise: Number(availableCredit(BigInt(corp.creditLimitPaise), receivable)),
    charges,
    paidPaise: Number(paid),
    aging: {
      current: Number(buckets.current),
      days31to60: Number(buckets.days31to60),
      days61to90: Number(buckets.days61to90),
      days90plus: Number(buckets.days90plus),
      totalPaise: Number(buckets.totalPaise),
    },
  };
}

// ── Attribution & commission (FR-5/6, AC-5/6) ───────────────────────────────

export type AttributionRow = { id: string; name: string; revenuePaise: number; roomNights: number };
export type AttributionReport = { corporates: AttributionRow[]; agents: AttributionRow[] };

/**
 * Revenue by corporate + by travel agent over a range, top-N by revenue (FR-5,
 * AC-5). Revenue is non-tax, net-of-discount folio lines (reconciles with 08/14).
 */
export async function attributionReport(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date; topN?: number },
): Promise<AttributionReport> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null); // AC-8

  const reservations = await db.scoped(user).reservation.findMany({
    where: {
      propertyId: { in: input.propertyIds },
      checkInDate: { gte: input.from, lte: input.to },
      status: { in: [...IN_STAY] },
      OR: [{ corporateId: { not: null } }, { travelAgentId: { not: null } }],
    },
    select: {
      corporateId: true, travelAgentId: true, nights: true,
      corporate: { select: { name: true } },
      travelAgent: { select: { name: true } },
      folio: { select: { lines: { select: { amountPaise: true, type: true } } } },
    },
  });

  const corp = new Map<string, AttributionRow>();
  const agent = new Map<string, AttributionRow>();
  for (const r of reservations) {
    let revenue = 0;
    for (const l of r.folio?.lines ?? []) if (l.type !== "TAX") revenue += Number(l.amountPaise);
    if (r.corporateId) {
      const row = corp.get(r.corporateId) ?? { id: r.corporateId, name: r.corporate?.name ?? "?", revenuePaise: 0, roomNights: 0 };
      row.revenuePaise += revenue; row.roomNights += r.nights;
      corp.set(r.corporateId, row);
    }
    if (r.travelAgentId) {
      const row = agent.get(r.travelAgentId) ?? { id: r.travelAgentId, name: r.travelAgent?.name ?? "?", revenuePaise: 0, roomNights: 0 };
      row.revenuePaise += revenue; row.roomNights += r.nights;
      agent.set(r.travelAgentId, row);
    }
  }
  const topN = input.topN ?? 20;
  const rank = (m: Map<string, AttributionRow>) => [...m.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, topN);
  return { corporates: rank(corp), agents: rank(agent) };
}

export type AgentCommissionRow = {
  id: string;
  name: string;
  commissionBps: number;
  roomRevenuePaise: number;
  commissionPayablePaise: number;
};

/**
 * Commission payable per travel agent (FR-6, AC-6): agent's commissionBps applied
 * to attributed ROOM revenue only (never tax/F&B), computed by the pure domain fn.
 */
export async function agentCommission(
  user: SessionClaims,
  input: { propertyIds: string[]; from: Date; to: Date },
): Promise<AgentCommissionRow[]> {
  authorize(user, "report:view-financial", input.propertyIds[0] ?? null); // AC-8

  const reservations = await db.scoped(user).reservation.findMany({
    where: {
      propertyId: { in: input.propertyIds },
      travelAgentId: { not: null },
      checkInDate: { gte: input.from, lte: input.to },
      status: { in: [...IN_STAY] },
    },
    select: {
      travelAgentId: true,
      travelAgent: { select: { name: true, commissionBps: true } },
      folio: { select: { lines: { select: { amountPaise: true, type: true } } } },
    },
  });

  const byAgent = new Map<string, { name: string; bps: number; roomRevenue: bigint }>();
  for (const r of reservations) {
    if (!r.travelAgentId || !r.travelAgent) continue;
    const acc = byAgent.get(r.travelAgentId) ?? { name: r.travelAgent.name, bps: r.travelAgent.commissionBps, roomRevenue: 0n };
    for (const l of r.folio?.lines ?? []) if (l.type === "ROOM") acc.roomRevenue += BigInt(l.amountPaise);
    byAgent.set(r.travelAgentId, acc);
  }

  return [...byAgent.entries()]
    .map(([id, a]) => ({
      id,
      name: a.name,
      commissionBps: a.bps,
      roomRevenuePaise: Number(a.roomRevenue),
      commissionPayablePaise: Number(commissionOnRevenue(a.roomRevenue, a.bps)),
    }))
    .sort((x, y) => y.commissionPayablePaise - x.commissionPayablePaise);
}
