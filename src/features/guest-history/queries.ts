/**
 * Guest-history queries — 05 T-7 (FR-3/4, AC-5/6). Stats + payments + feedback +
 * bills for a guest. Financial figures (revenue, outstanding, amounts, bill
 * totals) are gated by `report:view-financial`; stay counts are always visible so
 * front desk keeps context without seeing money (AC-6). Reads via the derived
 * snapshot; source stays authoritative through reconcile.
 */
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import { guestTier, type GuestTierInfo } from "./domain/tier";
import type { SessionClaims } from "@/lib/auth/claims";

/**
 * Batched guest tiers for a set of guests — the list/search hot path. ONE indexed
 * read of the derived stats snapshot for every id (no N+1), then the pure
 * `guestTier` per guest. Revenue is honoured only with `report:view-financial`;
 * otherwise tier falls back to visit count (always visible). Guest ids must
 * already be caller-scoped (they come from the org-scoped guest search).
 */
export async function guestTiers(
  user: SessionClaims,
  guestIds: string[],
): Promise<Record<string, GuestTierInfo>> {
  if (guestIds.length === 0) return {};
  const canSeeMoney = hasPermission(user, "report:view-financial");
  const snaps = await db.unscoped().guestStatsSnapshot.findMany({
    where: { guestId: { in: guestIds } },
    select: { guestId: true, visits: true, totalRevenuePaise: true },
  });
  const byId = new Map(snaps.map((s) => [s.guestId, s]));
  const out: Record<string, GuestTierInfo> = {};
  for (const id of guestIds) {
    const s = byId.get(id);
    out[id] = guestTier({
      visits: s?.visits ?? 0,
      revenuePaise: canSeeMoney ? Number(s?.totalRevenuePaise ?? 0n) : null,
    });
  }
  return out;
}

export type GuestHistoryView = {
  visits: number;
  totalRoomNights: number;
  preferredCategoryId: string | null;
  lastStayAt: Date | null;
  /** Null when the caller lacks financial permission (AC-6). */
  totalRevenuePaise: number | null;
  outstandingPaise: number | null;
  bills: { number: string; type: string; totalPaise: number | null; pdfObjectKey: string | null }[];
  payments: { mode: string; amountPaise: number | null; isRefund: boolean; receivedAt: Date }[];
  feedback: { rating: number | null; comment: string | null; sentiment: string | null; createdAt: Date }[];
};

export async function getGuestHistory(user: SessionClaims, guestId: string): Promise<GuestHistoryView> {
  const prisma = db.unscoped();
  const canSeeMoney = hasPermission(user, "report:view-financial");

  const [snapshot, invoices, payments, feedback] = await Promise.all([
    prisma.guestStatsSnapshot.findUnique({ where: { guestId } }),
    prisma.invoice.findMany({
      where: { folio: { reservation: { guestId, property: { orgId: user.orgId } } } },
      select: { number: true, type: true, totalPaise: true, pdfObjectKey: true },
      orderBy: { issuedAt: "desc" },
      take: 50,
    }),
    prisma.payment.findMany({
      where: { folio: { reservation: { guestId, property: { orgId: user.orgId } } } },
      select: { mode: true, amountPaise: true, isRefund: true, receivedAt: true },
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    // Feedback has no `property` relation; a guest belongs to one org, so
    // filtering by guestId is already org-safe.
    prisma.feedback.findMany({
      where: { guestId },
      select: { rating: true, comment: true, sentiment: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return {
    visits: snapshot?.visits ?? 0,
    totalRoomNights: snapshot?.totalRoomNights ?? 0,
    preferredCategoryId: snapshot?.preferredCategoryId ?? null,
    lastStayAt: snapshot?.lastStayAt ?? null,
    totalRevenuePaise: canSeeMoney ? Number(snapshot?.totalRevenuePaise ?? 0n) : null,
    outstandingPaise: canSeeMoney ? Number(snapshot?.outstandingPaise ?? 0n) : null,
    bills: invoices.map((i) => ({ number: i.number, type: i.type, totalPaise: canSeeMoney ? Number(i.totalPaise) : null, pdfObjectKey: i.pdfObjectKey })),
    payments: payments.map((p) => ({ mode: p.mode, amountPaise: canSeeMoney ? Number(p.amountPaise) : null, isRefund: p.isRefund, receivedAt: p.receivedAt })),
    feedback: feedback.map((f) => ({ rating: f.rating, comment: f.comment, sentiment: f.sentiment, createdAt: f.createdAt })),
  };
}
