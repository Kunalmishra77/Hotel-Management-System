/**
 * Booking core — 03 T-12/T-14/T-15 (FR-3/4/6/7/15/16/19, AC-1/2/3/6/7/13).
 * NOT a "use server" module — shared engine behind createReservation (confirmed)
 * and holdReservation (ENQUIRY hold). One path so the two cannot diverge.
 *
 * The concurrency-safe heart: a SERIALIZABLE transaction re-checks availability
 * (allocations AND blocks) for the exact candidate rooms, inserts the reservation
 * + one allocation per room (all-or-nothing for a group), flips rooms to RESERVED,
 * ensures a folio on confirm, and emits the event + audit. The `room_no_overlap`
 * exclusion constraint is the final backstop; `bookingAttempt` retries once on a
 * serialization failure and maps a constraint violation to ROOM_UNAVAILABLE.
 */
import { hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { ensureFolio } from "@/features/billing";
import { nights as computeNights } from "./domain/nights";
import { checkRateFloor } from "./domain/rate-floor";
import { freeRoomIdsFor, type RoomFinder } from "./availability";
import {
  assertBookingDatesValid,
  bookingAttempt,
  generateReservationCode,
  isUniqueViolation,
  reservationDb,
  RESERVATION_SELECT,
  todayLocalEpochDay,
  utcEpochDay,
} from "./internal";
import { validateSegments } from "./domain/split-stay";
import type { CreateReservationInput, HoldReservationInput } from "./schema";
import type { SessionClaims } from "@/lib/auth/claims";

export type ReservationSummary = {
  id: string;
  code: string;
  status: string;
  nights: number;
  roomIds: string[];
};

type BookingInput = CreateReservationInput | HoldReservationInput;

/** Create a confirmed booking or a tentative hold (`opts.hold`). */
export async function createBooking(
  user: SessionClaims,
  data: BookingInput,
  opts: { hold: boolean },
): Promise<ReservationSummary> {
  const client = reservationDb(user);

  // --- Load property config + candidate rooms (scoped) --------------------
  const property = await client.property.findFirst({
    where: { id: data.propertyId },
    select: { id: true, timezone: true, dayUseEnabled: true, holdTtlHours: true },
  });
  if (!property) throw new NotFoundError("Property not found.");

  assertBookingDatesValid({
    checkInDate: data.checkInDate,
    checkOutDate: data.checkOutDate,
    dayUseEnabled: property.dayUseEnabled,
    tz: property.timezone,
  });

  const nights = computeNights(data.checkInDate, data.checkOutDate, property.timezone);

  const rooms = await client.room.findMany({
    where: { id: { in: data.roomIds }, propertyId: data.propertyId },
    select: {
      id: true,
      categoryId: true,
      category: { select: { maxAdults: true, maxChildren: true, floorPaise: true } },
    },
  });
  if (rooms.length !== data.roomIds.length) {
    throw new NotFoundError("One or more rooms were not found in this property.");
  }

  // --- Occupancy is ADVISORY, never a hard gate (client decision) ---------
  // The client's rule: party size must never block a booking — an extra guest just
  // takes a mattress. The category's max is informational only (consistent with
  // availability.ts, which already refuses to hide a room by occupancy). So we do
  // NOT reject an over-capacity booking here; staff add an extra bed/charge as needed.

  // --- Rate floor / discount threshold (against the primary category) -----
  const settings = await client.securitySettings.findFirst({
    where: { orgId: user.orgId },
    select: { discountThresholdPaise: true },
  });
  const floorCheck = checkRateFloor(
    { floorPaise: rooms[0]!.category.floorPaise },
    data.ratePaise,
    data.discountPaise,
    {
      discountThresholdPaise: settings?.discountThresholdPaise ?? 100_000,
      hasDiscountPermission: hasPermission(user, "folio:discount"),
    },
  );
  if (!floorCheck.ok) throw new DomainError(ErrorCode.RATE_BELOW_FLOOR);
  const isOverride = floorCheck.override;

  // Split stay: the allocation plan is the submitted segments; otherwise every room
  // for the whole stay. Each segment's room must be one of the booking's rooms.
  const segments = "segments" in data && data.segments && data.segments.length > 0 ? data.segments : null;
  if (segments) {
    const problem = validateSegments(segments, data.checkInDate, data.checkOutDate);
    if (problem) throw new DomainError(ErrorCode.VALIDATION_FAILED, problem, { publicMessage: problem });
    if (segments.some((s) => !data.roomIds.includes(s.roomId))) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Split-stay room not in the booking.");
    }
  }
  const plan = segments
    ? segments.map((s) => ({ roomId: s.roomId, startDate: s.startDate, endDate: s.endDate }))
    : data.roomIds.map((roomId) => ({ roomId, startDate: data.checkInDate, endDate: data.checkOutDate }));
  // Board status: only a stay starting today (or earlier) flips its first room(s) to
  // RESERVED. A future booking used to overwrite the board status now — marking a
  // room someone is sleeping in tonight as "Reserved".
  const startsNow = utcEpochDay(data.checkInDate) <= todayLocalEpochDay(property.timezone);
  const firstRoomIds = [...new Set(plan.filter((p) => p.startDate.getTime() === data.checkInDate.getTime()).map((p) => p.roomId))];

  const holdExpiresAt = opts.hold
    ? new Date(Date.now() + property.holdTtlHours * 3_600_000)
    : null;
  const status = opts.hold ? "ENQUIRY" : "CONFIRMED";

  // --- The atomic booking transaction -------------------------------------
  return bookingAttempt(() =>
    client.$transaction(
      async (tx) => {
        // Re-check the specific candidates under the serializable lock. Any
        // candidate now taken (by allocation OR block) fails the WHOLE group.
        for (const seg of plan) {
          const free = await freeRoomIdsFor(tx as unknown as RoomFinder, data.propertyId, [seg.roomId], seg.startDate, seg.endDate);
          if (!free.has(seg.roomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
        }

        // Insert the reservation, regenerating the code on the rare collision.
        let reservation: { id: string; code: string; status: string; nights: number } | null = null;
        for (let attempt = 0; attempt < 3 && !reservation; attempt++) {
          try {
            reservation = await tx.reservation.create({
              data: {
                propertyId: data.propertyId,
                code: generateReservationCode(),
                guestId: data.guestId,
                status,
                source: data.source,
                corporateId: data.corporateId ?? null,
                travelAgentId: data.travelAgentId ?? null,
                checkInDate: data.checkInDate,
                checkOutDate: data.checkOutDate,
                expectedArrival: data.expectedArrival ?? null,
                nights,
                adults: data.adults,
                children: data.children,
                holdExpiresAt,
                ratePaise: data.ratePaise,
                discountPaise: data.discountPaise,
                extraBedPaise: data.extraBedPaise,
                taxPaise: data.taxPaise,
                otherChargesPaise: data.otherChargesPaise,
                advancePaise: data.advancePaise,
                settlementIntent: data.settlementIntent,
                notes: data.notes ?? null,
              },
              select: { id: true, code: true, status: true, nights: true },
            });
          } catch (e) {
            if (isUniqueViolation(e) && attempt < 2) continue; // code clash → new code
            throw e;
          }
        }
        if (!reservation) throw new DomainError(ErrorCode.CONFLICT, "Could not allocate a booking code.");

        // One allocation per room (or per split-stay segment) — the exclusion
        // constraint guarantees no overlap.
        for (const seg of plan) {
          await tx.roomAllocation.create({
            data: {
              propertyId: data.propertyId,
              reservationId: reservation.id,
              roomId: seg.roomId,
              startDate: seg.startDate,
              endDate: seg.endDate,
            },
          });
        }

        // An arriving-today booking marks its (vacant) first room(s) RESERVED. Only
        // VACANT rooms flip — a room still being cleaned stays HOUSEKEEPING.
        if (startsNow) {
          const flipped = await tx.room.findMany({ where: { id: { in: firstRoomIds }, status: "VACANT" }, select: { id: true } });
          await tx.room.updateMany({ where: { id: { in: flipped.map((f) => f.id) } }, data: { status: "RESERVED" } });
          for (const { id: roomId } of flipped) {
            await emitEvent(tx, {
              type: "RoomStatusChanged",
              aggregateId: roomId,
              propertyId: data.propertyId,
              payload: { to: "RESERVED", reason: "reservation", reservationId: reservation.id },
            });
          }
        }

        // A confirmed booking gets its folio now (FR-7); a hold does not.
        if (!opts.hold) {
          await ensureFolio(tx, { reservationId: reservation.id, propertyId: data.propertyId });
        }

        await emitEvent(tx, {
          type: "ReservationCreated",
          aggregateId: reservation.id,
          propertyId: data.propertyId,
          payload: {
            code: reservation.code,
            status,
            source: data.source,
            roomIds: data.roomIds,
            nights,
            hold: opts.hold,
          },
        });
        await writeAudit(tx, {
          action: opts.hold ? "reservation:hold" : "reservation:create",
          entityType: "Reservation",
          entityId: reservation.id,
          propertyId: data.propertyId,
          after: {
            code: reservation.code, status, roomIds: data.roomIds,
            ...(segments ? { splitStay: plan.map((p) => ({ roomId: p.roomId, from: p.startDate.toISOString().slice(0, 10), to: p.endDate.toISOString().slice(0, 10) })) } : {}),
          },
        });

        // FR-19: an over-threshold rate/discount is allowed only with permission
        // AND leaves an audited override trail.
        if (isOverride) {
          await writeAudit(tx, {
            action: "reservation:rate-override",
            entityType: "Reservation",
            entityId: reservation.id,
            propertyId: data.propertyId,
            reason: "Rate below floor / discount above threshold, approved by folio:discount holder",
            after: { ratePaise: data.ratePaise, discountPaise: data.discountPaise },
          });
        }

        return {
          id: reservation.id,
          code: reservation.code,
          status: reservation.status,
          nights: reservation.nights,
          roomIds: data.roomIds,
        };
      },
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
    ),
  );
}

export { RESERVATION_SELECT };
