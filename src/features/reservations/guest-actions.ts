"use server";

/**
 * Accompanying-guest + occupancy management on an existing booking (03 FR —
 * guest add-ons). Extra people who arrive at/after check-in are attached to the
 * SAME reservation, never a new booking. Each action: validate → authorize
 * (reservation:modify, property-scoped) → transaction → ReservationModified
 * event → audit.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { revalidatePath } from "next/cache";
import { reservationDb, withReservationContext } from "./internal";
import {
  addReservationGuestSchema,
  removeReservationGuestSchema,
  updateOccupancySchema,
} from "./schema";

/** Bookings that can still take occupant changes (not terminal). */
const ACTIVE = new Set(["ENQUIRY", "CONFIRMED", "IN_HOUSE"]);

/** Add an accompanying guest to an existing booking (no new booking). */
export async function addReservationGuest(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = addReservationGuestSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: { id: true, propertyId: true, status: true },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);
    if (!ACTIVE.has(r.status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Guests can only be added to an active booking.");
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        const g = await tx.reservationGuest.create({
          data: {
            propertyId: r.propertyId,
            reservationId: r.id,
            fullName: data.fullName,
            age: data.age ?? null,
            gender: data.gender ?? null,
            relation: data.relation ?? null,
          },
          select: { id: true },
        });
        await emitEvent(tx, {
          type: "ReservationModified",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { reservationId: r.id, change: "guest-added" },
        });
        await writeAudit(tx, {
          action: "reservation:add-guest",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          after: { fullName: data.fullName },
        });
        revalidatePath(`/bookings/${r.id}`);
        return { id: g.id };
      }),
    );
  });
}

/** Remove an accompanying guest from a booking. */
export async function removeReservationGuest(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const { reservationGuestId } = removeReservationGuestSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const rg = await client.reservationGuest.findFirst({
      where: { id: reservationGuestId },
      select: { id: true, propertyId: true, reservationId: true, fullName: true },
    });
    if (!rg) throw new NotFoundError("Guest not found on this booking.");
    authorize(user, "reservation:modify", rg.propertyId);

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservationGuest.delete({ where: { id: rg.id } });
        await emitEvent(tx, {
          type: "ReservationModified",
          aggregateId: rg.reservationId,
          propertyId: rg.propertyId,
          payload: { reservationId: rg.reservationId, change: "guest-removed" },
        });
        await writeAudit(tx, {
          action: "reservation:remove-guest",
          entityType: "Reservation",
          entityId: rg.reservationId,
          propertyId: rg.propertyId,
          before: { fullName: rg.fullName },
        });
        revalidatePath(`/bookings/${rg.reservationId}`);
        return { id: rg.id };
      }),
    );
  });
}

/** Adjust the occupancy counts (adults/children) on a booking, incl. during stay. */
export async function updateReservationOccupancy(input: unknown): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const data = updateOccupancySchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: { id: true, propertyId: true, status: true, adults: true, children: true },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);
    if (!ACTIVE.has(r.status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Occupancy can only change on an active booking.");
    }

    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservation.update({
          where: { id: r.id },
          data: { adults: data.adults, children: data.children },
        });
        await emitEvent(tx, {
          type: "ReservationModified",
          aggregateId: r.id,
          propertyId: r.propertyId,
          payload: { reservationId: r.id, change: "occupancy" },
        });
        await writeAudit(tx, {
          action: "reservation:update-occupancy",
          entityType: "Reservation",
          entityId: r.id,
          propertyId: r.propertyId,
          before: { adults: r.adults, children: r.children },
          after: { adults: data.adults, children: data.children },
        });
        revalidatePath(`/bookings/${r.id}`);
        return { id: r.id };
      }),
    );
  });
}
