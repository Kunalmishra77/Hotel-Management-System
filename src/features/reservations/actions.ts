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
import { reservationDb, withReservationContext } from "./internal";
import {
  createReservationSchema,
  holdReservationSchema,
  confirmReservationSchema,
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
