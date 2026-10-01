"use server";

/**
 * Reservation booking actions — 03 T-11/T-12/T-14/T-14b (FR-2/3/4/6/7/16/23).
 *
 * Thin boundary: validate → authorize → delegate to the booking core / a small
 * transaction, all inside the request context so audit + events carry the actor.
 * The heavy concurrency logic lives in `booking.ts`; lifecycle transitions in
 * `lifecycle-actions.ts`; channel ingest in `channel-actions.ts`.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { ensureFolio } from "@/features/billing";
import { canTransition } from "./domain/transitions";
import { createBooking, type ReservationSummary } from "./booking";
import { reservationDb, withReservationContext, generateReservationCode } from "./internal";
import { nights as computeNights } from "./domain/nights";
import {
  createReservationSchema,
  holdReservationSchema,
  confirmReservationSchema,
  externalStaySchema,
} from "./schema";

export type { ReservationSummary };

/** Create a confirmed booking (single or group), concurrency-safe (AC-1/2/3/6/13). */
export async function createReservation(input: unknown): Promise<Result<ReservationSummary>> {
  return toResult(async () => {
    const data = createReservationSchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:create", data.propertyId);
    return withReservationContext(user, () => createBooking(user, data, { hold: false }));
  });
}

/**
 * #1 — record an "Other" (off-site) stay at a property we don't operate. No room,
 * no availability, no folio: just guest + dates + external hotel name/address (+
 * an optional amount for reference). Owned by a real property for scope. Still
 * validate → authorize → transaction → event → audit (business-rules §20).
 */
export async function createExternalStay(input: unknown): Promise<Result<{ id: string; code: string }>> {
  return toResult(async () => {
    const data = externalStaySchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:create", data.propertyId);
    const nights = computeNights(data.checkInDate, data.checkOutDate);
    return withReservationContext(user, () =>
      reservationDb(user).$transaction(async (tx) => {
        let created: { id: string; code: string } | null = null;
        for (let attempt = 0; attempt < 3 && !created; attempt++) {
          try {
            created = await tx.reservation.create({
              data: {
                propertyId: data.propertyId,
                code: generateReservationCode(),
                guestId: data.guestId,
                status: "CONFIRMED",
                source: data.source,
                checkInDate: data.checkInDate,
                checkOutDate: data.checkOutDate,
                nights,
                adults: data.adults,
                children: data.children,
                ratePaise: data.amountPaise,
                externalHotelName: data.externalHotelName,
                externalHotelAddress: data.externalHotelAddress,
                notes: data.notes ?? null,
              },
              select: { id: true, code: true },
            });
          } catch (e) {
            // Retry on a reservation-code clash; rethrow anything else.
            if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002" && attempt < 2) continue;
            throw e;
          }
        }
        if (!created) throw new DomainError(ErrorCode.CONFLICT, "Could not allocate a booking code.");
        await emitEvent(tx, {
          type: "ReservationCreated",
          aggregateId: created.id,
          propertyId: data.propertyId,
          payload: { code: created.code, external: true, hotel: data.externalHotelName },
        });
        await writeAudit(tx, {
          action: "reservation:create",
          entityType: "Reservation",
          entityId: created.id,
          propertyId: data.propertyId,
          after: { code: created.code, external: true, hotel: data.externalHotelName },
        });
        return created;
      }),
    );
  });
}

/** Create a tentative ENQUIRY hold that consumes inventory until expiry (FR-16). */
export async function holdReservation(input: unknown): Promise<Result<ReservationSummary>> {
  return toResult(async () => {
    const data = holdReservationSchema.parse(input);
    const user = await requireUser();
    authorize(user, "reservation:create", data.propertyId);
    return withReservationContext(user, () => createBooking(user, data, { hold: true }));
  });
}

/** Promote a hold ENQUIRY→CONFIRMED, ensuring a folio; keeps the allocation (FR-23). */
export async function confirmReservation(input: unknown): Promise<Result<ReservationSummary>> {
  return toResult(async () => {
    const { reservationId } = confirmReservationSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const existing = await client.reservation.findFirst({
      where: { id: reservationId },
      select: {
        id: true, propertyId: true, code: true, status: true, nights: true,
        allocations: { select: { roomId: true } },
      },
    });
    if (!existing) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:create", existing.propertyId);

    if (!canTransition(existing.status, "CONFIRMED")) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservation.updateMany({
          where: { id: existing.id },
          // The hold's inventory carries straight in — no re-check, no re-allocation.
          data: { status: "CONFIRMED", holdExpiresAt: null },
        });
        await ensureFolio(tx, { reservationId: existing.id, propertyId: existing.propertyId });

        await emitEvent(tx, {
          type: "ReservationCreated",
          aggregateId: existing.id,
          propertyId: existing.propertyId,
          payload: { code: existing.code, status: "CONFIRMED", confirmedFromHold: true },
        });
        await writeAudit(tx, {
          action: "reservation:confirm",
          entityType: "Reservation",
          entityId: existing.id,
          propertyId: existing.propertyId,
          before: { status: existing.status },
          after: { status: "CONFIRMED" },
        });

        return {
          id: existing.id,
          code: existing.code,
          status: "CONFIRMED",
          nights: existing.nights,
          roomIds: existing.allocations.map((a) => a.roomId),
        };
      }),
    );
  });
}
