/**
 * Reservation background jobs — 03 T-14/T-21 (FR-16/18, AC-14/22).
 * NOT a "use server" module — these run in the pg-boss worker / night audit (14),
 * not from a request, so they use a system context and the unscoped client
 * (they legitimately sweep every property).
 *
 * Both are IDEMPOTENT: each re-reads the row's status inside the transaction, so
 * a hold confirmed (or a booking checked in) between the sweep's read and its
 * write is left untouched — a second run does nothing.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { utcEpochDay } from "./internal";

/**
 * Release tentative holds whose TTL has passed (FR-16, AC-14): allocations
 * dropped, rooms freed, reservation → CANCELLED. Called on a schedule by the
 * worker. Returns how many were released.
 */
export async function releaseExpiredHolds(now: Date = new Date()): Promise<{ released: number }> {
  const prisma = db.unscoped();
  const expired = await prisma.reservation.findMany({
    where: { status: "ENQUIRY", holdExpiresAt: { lt: now } },
    select: {
      id: true,
      propertyId: true,
      allocations: { select: { roomId: true } },
      property: { select: { orgId: true } },
    },
  });

  let released = 0;
  for (const r of expired) {
    await runWithSystemContext(r.property.orgId, () =>
      prisma.$transaction(async (tx) => {
        // Idempotent guard: skip if it was confirmed/cancelled since the sweep.
        const current = await tx.reservation.findUnique({
          where: { id: r.id },
          select: { status: true },
        });
        if (current?.status !== "ENQUIRY") return;

        await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
        await tx.reservation.update({
          where: { id: r.id },
          data: { status: "CANCELLED", holdExpiresAt: null },
        });
        for (const a of r.allocations) {
          await tx.room.updateMany({ where: { id: a.roomId }, data: { status: "VACANT" } });
          await emitEvent(tx, {
            type: "RoomStatusChanged",
            aggregateId: a.roomId,
            propertyId: r.propertyId,
            payload: { to: "VACANT", reason: "hold-expired" },
          });
        }
        await emitEvent(tx, {
          type: "ReservationCancelled",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { reason: "hold-expired" },
        });
        await writeAudit(tx, {
          action: "reservation:hold-expired",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          before: { status: "ENQUIRY" },
          after: { status: "CANCELLED" },
        });
        released += 1;
      }),
    );
  }

  return { released };
}

/**
 * Night-audit no-show sweep (FR-18, AC-22): CONFIRMED bookings whose check-in
 * date is on/before the business date and were never checked in become NO_SHOW,
 * their allocations released and rooms reset to VACANT. The advance is retained
 * or released per `Property.noShowRetainAdvance`.
 */
export async function markNoShows(
  propertyId: string,
  businessDate: Date,
): Promise<{ marked: number; retainedAdvance: boolean }> {
  const prisma = db.unscoped();
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { orgId: true, noShowRetainAdvance: true },
  });
  if (!property) return { marked: 0, retainedAdvance: false };

  const businessDay = utcEpochDay(businessDate);
  const candidates = await prisma.reservation.findMany({
    where: { propertyId, status: "CONFIRMED" },
    select: { id: true, checkInDate: true, allocations: { select: { roomId: true } } },
  });

  let marked = 0;
  await runWithSystemContext(property.orgId, () =>
    prisma.$transaction(async (tx) => {
      for (const r of candidates) {
        // A no-show is a booking whose check-in day has passed with no check-in.
        if (utcEpochDay(r.checkInDate) > businessDay) continue;

        const current = await tx.reservation.findUnique({
          where: { id: r.id },
          select: { status: true },
        });
        if (current?.status !== "CONFIRMED") continue; // idempotent

        await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
        await tx.reservation.update({ where: { id: r.id }, data: { status: "NO_SHOW" } });
        for (const a of r.allocations) {
          await tx.room.updateMany({ where: { id: a.roomId }, data: { status: "VACANT" } });
          await emitEvent(tx, {
            type: "RoomStatusChanged",
            aggregateId: a.roomId,
            propertyId,
            payload: { to: "VACANT", reason: "no-show" },
          });
        }
        await emitEvent(tx, {
          type: "NoShowMarked",
          aggregateId: r.id,
          propertyId,
          payload: { retainedAdvance: property.noShowRetainAdvance },
        });
        await writeAudit(tx, {
          action: "reservation:no-show",
          entityType: "Reservation",
          entityId: r.id,
          propertyId,
          before: { status: "CONFIRMED" },
          after: { status: "NO_SHOW", retainedAdvance: property.noShowRetainAdvance },
        });
        marked += 1;
      }
    }),
  );

  return { marked, retainedAdvance: property.noShowRetainAdvance };
}
