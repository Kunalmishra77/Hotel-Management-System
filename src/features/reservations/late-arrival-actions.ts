"use server";

/**
 * Guaranteed late arrival (client, 12 Nov 2026).
 *
 * A guest misses the check-in day but calls: "don't cancel — I'll come on any day
 * and pay from the booked date". Without this the night audit marks the booking
 * NO_SHOW the next night and releases its room, and an "undo" is undone again
 * by the following night's sweep. Guaranteeing the arrival:
 *  - keeps the booking CONFIRMED and its room held — the no-show sweep skips it;
 *  - lists it among today's arrivals every day until the guest comes;
 *  - bills from the booked check-in date when the guest is finally checked in
 *    (check-in posts every night from `checkInDate`, as it always does).
 * On a booking ALREADY marked NO_SHOW it also brings it back to CONFIRMED (the
 * no-show released the room, so a room is assigned with "Move / assign room").
 * Turning it off returns the booking to the normal no-show rule.
 */
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { reservationDb, withReservationContext } from "./internal";

const schema = z.object({
  reservationId: z.string().min(1),
  guaranteed: z.boolean(),
});

export type LateArrivalResult = { id: string; status: string; arrivalGuaranteed: boolean };

export async function setArrivalGuarantee(input: unknown): Promise<Result<LateArrivalResult>> {
  return toResult(async () => {
    const data = schema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: { id: true, code: true, status: true, propertyId: true, arrivalGuaranteed: true },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);

    const allowed = data.guaranteed ? ["CONFIRMED", "NO_SHOW"] : ["CONFIRMED"];
    if (!allowed.includes(r.status)) {
      const msg = data.guaranteed
        ? "Only a confirmed booking (or one marked no-show) can be held for a late arrival."
        : "Only a confirmed booking can have its late-arrival hold removed.";
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, msg, { publicMessage: msg });
    }

    const status = data.guaranteed && r.status === "NO_SHOW" ? "CONFIRMED" : r.status;
    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const flipped = await tx.reservation.updateMany({
          where: { id: r.id, status: r.status as never },
          data: { arrivalGuaranteed: data.guaranteed, status: status as never },
        });
        if (flipped.count !== 1) throw new DomainError(ErrorCode.CONFLICT, "This booking just changed — refresh and try again.");
        await emitEvent(tx, {
          type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId,
          payload: { code: r.code, arrivalGuaranteed: data.guaranteed, ...(status !== r.status ? { from: r.status, to: status } : {}) },
        });
        await writeAudit(tx, {
          action: "reservation:late-arrival", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
          reason: data.guaranteed ? "Guest will arrive late — room held, billed from the booked check-in date" : "Late-arrival hold removed",
          before: { status: r.status, arrivalGuaranteed: r.arrivalGuaranteed },
          after: { status, arrivalGuaranteed: data.guaranteed },
        });
        return { id: r.id, status, arrivalGuaranteed: data.guaranteed };
      }),
    );
  });
}
