/**
 * Recompute a guest's stats snapshot from source — 05 T-5/T-6 (FR-2/5).
 * NOT a "use server" module: called by the event consumer and the reconcile job,
 * both under a system context.
 *
 * The snapshot is a CACHE. This recomputes it from the authoritative source every
 * time (03 reservations + 06 `guestBilling`), which makes it inherently
 * idempotent — a re-delivered event or a reconcile run both converge to the same
 * numbers, never a double count (AC-3/4/10/11).
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { guestBilling } from "@/features/billing/queries";
import { deriveStats, type HistoryReservation } from "./domain/derive";
import type { SessionClaims } from "@/lib/auth/claims";

export async function recomputeGuestStats(orgId: string, guestId: string): Promise<void> {
  const prisma = db.unscoped();

  const rows = await prisma.reservation.findMany({
    where: { guestId, property: { orgId } },
    select: {
      status: true,
      nights: true,
      ratePaise: true,
      checkOutAt: true,
      checkInDate: true,
      allocations: { select: { room: { select: { categoryId: true } } }, take: 1 },
    },
  });

  const reservations: HistoryReservation[] = rows.map((r) => ({
    status: r.status,
    nights: r.nights,
    ratePaise: r.ratePaise,
    checkOutAt: r.checkOutAt,
    checkInDate: r.checkInDate,
    categoryId: r.allocations[0]?.room.categoryId ?? null,
  }));

  // Money is authoritative from 06 — one roll-up call, no per-reservation fan-out.
  const billing = await guestBilling({ orgId } as SessionClaims, guestId);
  const stats = deriveStats(reservations, { revenuePaise: billing.revenuePaise, outstandingPaise: billing.outstandingPaise });

  await runWithSystemContext(orgId, () =>
    prisma.$transaction(async (tx) => {
      await tx.guestStatsSnapshot.upsert({
        where: { guestId },
        create: {
          guestId,
          visits: stats.visits,
          totalRoomNights: stats.totalRoomNights,
          totalRevenuePaise: BigInt(stats.totalRevenuePaise),
          outstandingPaise: BigInt(stats.outstandingPaise),
          preferredCategoryId: stats.preferredCategoryId,
          preferredRatePaise: stats.preferredRatePaise,
          lastStayAt: stats.lastStayAt,
          lastReconciledAt: new Date(),
        },
        update: {
          visits: stats.visits,
          totalRoomNights: stats.totalRoomNights,
          totalRevenuePaise: BigInt(stats.totalRevenuePaise),
          outstandingPaise: BigInt(stats.outstandingPaise),
          preferredCategoryId: stats.preferredCategoryId,
          preferredRatePaise: stats.preferredRatePaise,
          lastStayAt: stats.lastStayAt,
          lastReconciledAt: new Date(),
        },
      });
      await emitEvent(tx, { type: "GuestStatsUpdated", aggregateId: guestId, payload: { visits: stats.visits, totalRevenuePaise: stats.totalRevenuePaise } });
    }),
  );
}

/** Reconcile one guest, or every guest with a snapshot, from source (FR-5, AC-4/11). */
export async function reconcileGuestStats(orgId: string, guestId?: string): Promise<{ reconciled: number }> {
  const prisma = db.unscoped();
  if (guestId) {
    await recomputeGuestStats(orgId, guestId);
    return { reconciled: 1 };
  }
  const guests = await prisma.guest.findMany({ where: { orgId }, select: { id: true } });
  for (const g of guests) await recomputeGuestStats(orgId, g.id);
  return { reconciled: guests.length };
}
