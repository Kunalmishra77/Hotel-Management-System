/**
 * Inbound modify/cancel — 13 T-13 (FR-8, AC-7). System-context application of an
 * OTA modification/cancellation onto an existing reservation (found by
 * `channelRef`). Releases/re-checks inventory through the SAME allocation model
 * 03 uses — cross-channel overbooking stays impossible by construction (FR-11).
 *
 * These run under the worker/webhook system context, where 03's user-gated
 * `modifyReservation`/`cancelReservation` (they call `requireUser()`) cannot be
 * invoked. 03's system-context inbound entrypoint today is `createFromChannel`
 * only; until it exposes `modifyFromChannel`/`cancelFromChannel`, this module
 * applies the change directly and emits 03's own `ReservationModified`/
 * `ReservationCancelled` events + audit. See the module review note (delta).
 */
import type { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { alertAdmin } from "@/lib/alerts";
import { logger } from "@/lib/logger";
import { freeRoomIdsFor, type RoomFinder } from "@/features/reservations/availability";
import { mapRoomType, type RoomTypeMappingRow } from "./domain/map-room-type";
import type { CanonicalReservation } from "./domain/source-map";
import { AlertCode } from "./internal";

/** A `@db.Date` value from an ISO calendar date, interpreted UTC-midnight. */
export function toUtcDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
}

/** Property-local nights between two `@db.Date`s (min 1). */
export function nightsBetween(from: Date, to: Date): number {
  const days = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  return Math.max(1, days);
}

type Account = {
  id: string;
  provider: string;
  orgId: string;
  mappings: RoomTypeMappingRow[];
};

export type LifecycleOutcome = {
  applied: boolean;
  reservationId: string | null;
  categoryId: string | null;
  outcome: string;
};

async function findByChannelRef(prisma: PrismaClient, propertyId: string, channelRef: string) {
  return prisma.reservation.findFirst({
    where: { propertyId, channelRef },
    select: {
      id: true,
      status: true,
      checkInDate: true,
      checkOutDate: true,
      allocations: { select: { id: true, roomId: true, room: { select: { categoryId: true } } } },
    },
  });
}

async function deadLetterUnknownRef(
  account: Account,
  canonical: CanonicalReservation,
  kind: string,
): Promise<LifecycleOutcome> {
  logger.error("channel.unknown_channelref", { provider: account.provider, externalId: canonical.externalId, kind });
  await alertAdmin({
    severity: "warning",
    code: AlertCode.UNKNOWN_REF,
    title: `Inbound ${kind} for an unknown channel reservation`,
    detail: { provider: account.provider, externalId: canonical.externalId },
  });
  return { applied: false, reservationId: null, categoryId: null, outcome: `DEAD_LETTER_UNKNOWN_REF_${kind}` };
}

/** Apply an OTA modification (dates and/or re-check the room). Never drops. */
export async function applyChannelModify(
  prisma: PrismaClient,
  account: Account,
  canonical: CanonicalReservation,
): Promise<LifecycleOutcome> {
  const r = await findByChannelRef(prisma, canonical.propertyId, canonical.externalId);
  if (!r) return deadLetterUnknownRef(account, canonical, "MODIFY");
  if (r.status === "CANCELLED" || r.status === "CHECKED_OUT" || r.status === "NO_SHOW") {
    logger.info("channel.modify_ignored_terminal", { externalId: canonical.externalId, status: r.status });
    return { applied: false, reservationId: r.id, categoryId: null, outcome: "IGNORED_TERMINAL" };
  }

  const checkInDate = toUtcDate(canonical.checkInDate);
  const checkOutDate = toUtcDate(canonical.checkOutDate);
  const nights = nightsBetween(checkInDate, checkOutDate);
  const alloc = r.allocations[0] ?? null;
  const categoryId =
    alloc?.room.categoryId ?? mapRoomType(account.mappings, canonical.externalRoomType);

  await runWithSystemContext(account.orgId, () =>
    prisma.$transaction(async (tx) => {
      let needsAttention: "OVERSELL" | null = null;

      if (alloc) {
        // Re-check the same room is free for the new range; drop then re-verify.
        await tx.roomAllocation.deleteMany({ where: { id: alloc.id } });
        const free = await freeRoomIdsFor(
          tx as unknown as RoomFinder,
          canonical.propertyId,
          [alloc.roomId],
          checkInDate,
          checkOutDate,
        );
        if (free.has(alloc.roomId)) {
          await tx.roomAllocation.create({
            data: {
              propertyId: canonical.propertyId,
              reservationId: r.id,
              roomId: alloc.roomId,
              startDate: checkInDate,
              endDate: checkOutDate,
            },
          });
        } else {
          // Room no longer free for the new dates — keep the booking, unallocated.
          needsAttention = "OVERSELL";
          await tx.room.updateMany({ where: { id: alloc.roomId }, data: { status: "VACANT" } });
          await emitEvent(tx, {
            type: "RoomStatusChanged",
            aggregateId: alloc.roomId,
            propertyId: canonical.propertyId,
            payload: { to: "VACANT", reason: "channel-modify" },
            orgId: account.orgId,
          });
        }
      }

      await tx.reservation.updateMany({
        where: { id: r.id },
        data: { checkInDate, checkOutDate, nights, ...(needsAttention ? { needsAttention } : {}) },
      });
      await emitEvent(tx, {
        type: "ReservationModified",
        aggregateId: r.id,
        propertyId: canonical.propertyId,
        payload: { checkInDate, checkOutDate, via: "channel", needsAttention },
        orgId: account.orgId,
      });
      await writeAudit(tx, {
        action: "channel:reservation-modify",
        entityType: "Reservation",
        entityId: r.id,
        propertyId: canonical.propertyId,
        orgId: account.orgId,
        before: { checkInDate: r.checkInDate, checkOutDate: r.checkOutDate },
        after: { checkInDate, checkOutDate, needsAttention },
      });
    }),
  );

  return { applied: true, reservationId: r.id, categoryId, outcome: "MODIFIED" };
}

/** Apply an OTA cancellation: release inventory, free rooms, cancel (FR-8). */
export async function applyChannelCancel(
  prisma: PrismaClient,
  account: Account,
  canonical: CanonicalReservation,
): Promise<LifecycleOutcome> {
  const r = await findByChannelRef(prisma, canonical.propertyId, canonical.externalId);
  if (!r) return deadLetterUnknownRef(account, canonical, "CANCEL");
  if (r.status === "CANCELLED") {
    return { applied: false, reservationId: r.id, categoryId: null, outcome: "ALREADY_CANCELLED" };
  }

  const categoryId =
    r.allocations[0]?.room.categoryId ?? mapRoomType(account.mappings, canonical.externalRoomType);
  const roomIds = r.allocations.map((a) => a.roomId);

  await runWithSystemContext(account.orgId, () =>
    prisma.$transaction(async (tx) => {
      await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
      await tx.reservation.updateMany({ where: { id: r.id }, data: { status: "CANCELLED" } });
      if (roomIds.length > 0) {
        await tx.room.updateMany({ where: { id: { in: roomIds } }, data: { status: "VACANT" } });
        for (const roomId of roomIds) {
          await emitEvent(tx, {
            type: "RoomStatusChanged",
            aggregateId: roomId,
            propertyId: canonical.propertyId,
            payload: { to: "VACANT", reason: "channel-cancel" },
            orgId: account.orgId,
          });
        }
      }
      await emitEvent(tx, {
        type: "ReservationCancelled",
        aggregateId: r.id,
        propertyId: canonical.propertyId,
        payload: { reason: "channel-cancel", externalId: canonical.externalId },
        orgId: account.orgId,
      });
      await writeAudit(tx, {
        action: "channel:reservation-cancel",
        entityType: "Reservation",
        entityId: r.id,
        propertyId: canonical.propertyId,
        orgId: account.orgId,
        before: { status: r.status },
        after: { status: "CANCELLED" },
      });
    }),
  );

  return { applied: true, reservationId: r.id, categoryId, outcome: "CANCELLED" };
}
