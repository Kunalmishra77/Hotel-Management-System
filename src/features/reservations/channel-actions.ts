/**
 * OTA channel ingest — 03 T-22 (FR-14, AC-20/27). NOT a "use server" action: it
 * is called by 13's webhook handler (signature already verified) under a system
 * context, not by a logged-in user.
 *
 * The contract that matters: a paid channel booking is NEVER dropped. It consumes
 * the same availability as a direct booking; but if the room-type mapping is
 * missing, or no room is free (oversell), the reservation is still ingested —
 * CONFIRMED, with a folio, but UNALLOCATED and flagged `needsAttention` for
 * reception to resolve. Idempotent on `channelRef` (defence-in-depth over 13's
 * inbox dedupe).
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { ensureFolio } from "@/features/billing";
import { nights as computeNights } from "./domain/nights";
import { findFreeRooms, type RoomFinder } from "./availability";
import { generateReservationCode } from "./internal";
import { createFromChannelSchema } from "./schema";

export type ChannelIngestResult = {
  id: string;
  code: string;
  needsAttention: "OVERSELL" | "MAPPING_MISSING" | null;
};

export async function createFromChannel(input: unknown): Promise<ChannelIngestResult> {
  const data = createFromChannelSchema.parse(input);
  const prisma = db.unscoped();

  const property = await prisma.property.findUnique({
    where: { id: data.propertyId },
    select: { orgId: true, timezone: true },
  });
  if (!property) throw new NotFoundError("Property not found.");

  // Idempotency: a re-pushed channelRef returns the existing reservation.
  const existing = await prisma.reservation.findFirst({
    where: { propertyId: data.propertyId, channelRef: data.channelRef },
    select: { id: true, code: true, needsAttention: true },
  });
  if (existing) return existing;

  const nights = computeNights(data.checkInDate, data.checkOutDate, property.timezone);

  return runWithSystemContext(property.orgId, () =>
    prisma.$transaction(async (tx) => {
      // Decide allocation. Missing mapping and oversell both ingest unallocated.
      let needsAttention: "OVERSELL" | "MAPPING_MISSING" | null = null;
      let chosenRoomId: string | null = null;

      if (!data.categoryId && data.roomIds.length === 0) {
        needsAttention = "MAPPING_MISSING";
      } else {
        const free = await findFreeRooms(tx as unknown as RoomFinder, {
          propertyId: data.propertyId,
          categoryId: data.categoryId,
          roomIds: data.roomIds.length ? data.roomIds : undefined,
          checkInDate: data.checkInDate,
          checkOutDate: data.checkOutDate,
        });
        if (free.length === 0) needsAttention = "OVERSELL";
        else chosenRoomId = free[0]!.id;
      }

      const reservation = await tx.reservation.create({
        data: {
          propertyId: data.propertyId,
          code: generateReservationCode(),
          guestId: data.guestId,
          status: "CONFIRMED",
          source: data.source,
          channelRef: data.channelRef,
          channelAccountId: data.channelAccountId ?? null,
          checkInDate: data.checkInDate,
          checkOutDate: data.checkOutDate,
          nights,
          adults: data.adults,
          children: data.children,
          needsAttention,
          ratePaise: data.ratePaise,
          discountPaise: data.discountPaise,
          extraBedPaise: data.extraBedPaise,
          taxPaise: data.taxPaise,
          otherChargesPaise: data.otherChargesPaise,
          advancePaise: data.advancePaise,
        },
        select: { id: true, code: true },
      });

      // A paid booking always gets its folio, allocated or not.
      await ensureFolio(tx, { reservationId: reservation.id, propertyId: data.propertyId });

      if (chosenRoomId) {
        await tx.roomAllocation.create({
          data: {
            propertyId: data.propertyId,
            reservationId: reservation.id,
            roomId: chosenRoomId,
            startDate: data.checkInDate,
            endDate: data.checkOutDate,
          },
        });
        await tx.room.updateMany({ where: { id: chosenRoomId }, data: { status: "RESERVED" } });
        await emitEvent(tx, {
          type: "RoomStatusChanged",
          aggregateId: chosenRoomId,
          propertyId: data.propertyId,
          payload: { to: "RESERVED", reason: "channel" },
        });
      }

      await emitEvent(tx, {
        type: "ReservationCreated",
        aggregateId: reservation.id,
        propertyId: data.propertyId,
        payload: {
          code: reservation.code,
          source: data.source,
          channelRef: data.channelRef,
          needsAttention,
        },
      });
      await writeAudit(tx, {
        action: "reservation:channel-ingest",
        entityType: "Reservation",
        entityId: reservation.id,
        propertyId: data.propertyId,
        after: { code: reservation.code, source: data.source, needsAttention },
      });

      return { id: reservation.id, code: reservation.code, needsAttention };
    }),
  );
}
