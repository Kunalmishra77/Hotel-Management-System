/**
 * Guest-history queries — 05 T-7 (FR-3/4, AC-5/6). Stats + payments + feedback +
 * bills for a guest. Financial figures (revenue, outstanding, amounts, bill
 * totals) are gated by `report:view-financial`; stay counts are always visible so
 * front desk keeps context without seeing money (AC-6). Reads via the derived
 * snapshot; source stays authoritative through reconcile.
 */
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";

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
