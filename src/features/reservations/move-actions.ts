"use server";

/**
 * Modify + room-move — 03 T-16/T-18 (FR-8/20, AC-11/19).
 *
 * Both re-allocate atomically: the old allocation is dropped and the new one
 * created inside one SERIALIZABLE transaction that re-checks availability
 * (allocations AND blocks) for the target. A conflict aborts the whole thing —
 * no partial update, the original stands (AC-11). The exclusion constraint is the
 * final backstop; `bookingAttempt` retries once and maps a violation to
 * ROOM_UNAVAILABLE.
 *
 * Scope: single-room reservations. A group re-allocation is out of MVP scope and
 * is refused with a clear message rather than silently touching one room.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { ensureFolio, postRoomChargeTx, type BillingPostTx } from "@/features/billing";
import { nights as computeNights } from "./domain/nights";
import { freeRoomIdsFor, findFreeRooms, type RoomFinder } from "./availability";
import {
  assertBookingDatesValid,
  bookingAttempt,
  reservationDb,
  withReservationContext,
} from "./internal";
import { modifyReservationSchema, reallocateRoomSchema, extendStaySchema } from "./schema";

export type MoveResult = { id: string; status: string; roomId: string };

/** Modify dates and/or room of a CONFIRMED booking, atomically (AC-11). */
export async function modifyReservation(input: unknown): Promise<Result<MoveResult>> {
  return toResult(async () => {
    const data = modifyReservationSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true, propertyId: true, status: true, checkInDate: true, checkOutDate: true,
        allocations: { select: { id: true, roomId: true } },
        property: { select: { timezone: true, dayUseEnabled: true } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);

    if (r.status !== "CONFIRMED") throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);
    if (r.allocations.length !== 1) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Group bookings can't be modified in one step.");
    }

    const oldRoomId = r.allocations[0]!.roomId;
    const newRoomId = data.roomId ?? oldRoomId;
    const checkInDate = data.checkInDate ?? r.checkInDate;
    const checkOutDate = data.checkOutDate ?? r.checkOutDate;
    assertBookingDatesValid({
      checkInDate, checkOutDate,
      dayUseEnabled: r.property.dayUseEnabled, tz: r.property.timezone,
    });
    const nights = computeNights(checkInDate, checkOutDate, r.property.timezone);

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // Drop the old allocation first so the room's own booking doesn't
            // block the re-check, then verify the target is free for the range.
            await tx.roomAllocation.deleteMany({ where: { id: r.allocations[0]!.id } });
            const free = await freeRoomIdsFor(
              tx as unknown as RoomFinder, r.propertyId, [newRoomId], checkInDate, checkOutDate,
            );
            if (!free.has(newRoomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);

            await tx.roomAllocation.create({
              data: { propertyId: r.propertyId, reservationId: r.id, roomId: newRoomId, startDate: checkInDate, endDate: checkOutDate },
            });
            await tx.reservation.updateMany({ where: { id: r.id }, data: { checkInDate, checkOutDate, nights } });

            if (newRoomId !== oldRoomId) {
              await tx.room.updateMany({ where: { id: oldRoomId }, data: { status: "VACANT" } });
              await tx.room.updateMany({ where: { id: newRoomId }, data: { status: "RESERVED" } });
              await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: oldRoomId, propertyId: r.propertyId, payload: { to: "VACANT", reason: "modify" } });
              await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: newRoomId, propertyId: r.propertyId, payload: { to: "RESERVED", reason: "modify" } });
            }

            await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { checkInDate, checkOutDate, roomId: newRoomId } });
            await writeAudit(tx, {
              action: "reservation:modify", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
              before: { roomId: oldRoomId, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate },
              after: { roomId: newRoomId, checkInDate, checkOutDate },
            });
            return { id: r.id, status: r.status, roomId: newRoomId };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
        ),
      ),
    );
  });
}

/**
 * Extend an in-house (or confirmed) guest's stay to a later check-out date.
 *
 * `modifyReservation` only handles CONFIRMED bookings; a guest who has already
 * checked in and wants to stay longer needs this. It stretches the same room's
 * allocation to the new range (re-checking the room is free for the added nights),
 * updates the dates/nights, and bills the extra nights that have already elapsed
 * (property-local) onto the folio now — future nights post via the night audit.
 */
export async function extendStay(input: unknown): Promise<Result<MoveResult>> {
  return toResult(async () => {
    const data = extendStaySchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true, propertyId: true, status: true, checkInDate: true, checkOutDate: true, ratePaise: true,
        allocations: { select: { id: true, roomId: true, room: { select: { number: true } } } },
        folio: { select: { id: true } },
        property: { select: { timezone: true, state: true, dayUseEnabled: true } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);

    if (r.status !== "IN_HOUSE" && r.status !== "CONFIRMED") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Only a confirmed or in-house stay can be extended.", {
        publicMessage: "Only a confirmed or in-house stay can be extended.",
      });
    }
    if (r.allocations.length !== 1) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Group bookings can't be extended in one step.", {
        publicMessage: "Group bookings can't be extended in one step.",
      });
    }
    const newCheckOut = data.newCheckOutDate;
    if (newCheckOut.getTime() <= r.checkOutDate.getTime()) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "The new check-out must be after the current one.", {
        publicMessage: "The new check-out must be after the current one.",
      });
    }
    assertBookingDatesValid({
      checkInDate: r.checkInDate, checkOutDate: newCheckOut,
      dayUseEnabled: r.property.dayUseEnabled, tz: r.property.timezone,
    });
    const nights = computeNights(r.checkInDate, newCheckOut, r.property.timezone);
    const roomId = r.allocations[0]!.roomId;

    // Extra nights already elapsed (property-local) get billed now; the rest post
    // via the night audit as they pass.
    const todayStr = new Date().toLocaleDateString("en-CA", { timeZone: r.property.timezone });
    const todayMs = new Date(`${todayStr}T00:00:00.000Z`).getTime();
    const dayMs = 86_400_000;
    const extraNights: Date[] = [];
    for (let t = r.checkOutDate.getTime(); t < newCheckOut.getTime(); t += dayMs) {
      if (t <= todayMs) extraNights.push(new Date(t));
    }

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // Re-stretch the allocation: drop + recreate for the new range, checking
            // the room is free for the added nights (its own old allocation is gone).
            await tx.roomAllocation.deleteMany({ where: { id: r.allocations[0]!.id } });
            const free = await freeRoomIdsFor(tx as unknown as RoomFinder, r.propertyId, [roomId], r.checkInDate, newCheckOut);
            if (!free.has(roomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
            await tx.roomAllocation.create({
              data: { propertyId: r.propertyId, reservationId: r.id, roomId, startDate: r.checkInDate, endDate: newCheckOut },
            });
            await tx.reservation.updateMany({
              where: { id: r.id },
              data: { checkOutDate: newCheckOut, nights },
            });

            // Bill the elapsed extra nights now (idempotent per folio+date).
            if (extraNights.length > 0 && r.ratePaise > 0) {
              const folioId = r.folio?.id ?? (await ensureFolio(tx, { reservationId: r.id, propertyId: r.propertyId }));
              for (const businessDate of extraNights) {
                await postRoomChargeTx(tx as unknown as BillingPostTx, {
                  folioId,
                  propertyId: r.propertyId,
                  propertyState: r.property.state,
                  ratePaise: r.ratePaise,
                  businessDate,
                  postedById: user.userId,
                  description: `Room ${r.allocations[0]!.room?.number ?? ""} · night (extended)`.trim(),
                });
              }
            }

            await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { checkOutDate: newCheckOut, extended: true } });
            await writeAudit(tx, {
              action: "reservation:extend", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
              before: { checkOutDate: r.checkOutDate }, after: { checkOutDate: newCheckOut, nights },
            });
            return { id: r.id, status: r.status, roomId };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
        ),
      ),
    );
  });
}

/** Move a guest to another room (AC-19). `toRoomId` omitted → auto-pick same category. */
export async function reallocateRoom(input: unknown): Promise<Result<MoveResult>> {
  return toResult(async () => {
    const data = reallocateRoomSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true, propertyId: true, status: true, checkInDate: true, checkOutDate: true,
        allocations: { select: { id: true, roomId: true, room: { select: { categoryId: true } } } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);

    if (r.status !== "IN_HOUSE" && r.status !== "CONFIRMED") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION);
    }
    if (r.allocations.length !== 1) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Only a single-room booking can be moved.");
    }
    const alloc = r.allocations[0]!;
    // Room statuses depend on whether the guest is already in-house.
    const [vacatedStatus, occupiedStatus] =
      r.status === "IN_HOUSE" ? (["HOUSEKEEPING", "OCCUPIED"] as const) : (["VACANT", "RESERVED"] as const);

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            await tx.roomAllocation.deleteMany({ where: { id: alloc.id } });

            // Resolve the target: explicit, or the first free same-category room.
            let toRoomId = data.toRoomId;
            if (!toRoomId) {
              const candidates = await findFreeRooms(tx as unknown as RoomFinder, {
                propertyId: r.propertyId, categoryId: alloc.room.categoryId,
                checkInDate: r.checkInDate, checkOutDate: r.checkOutDate,
              });
              const pick = candidates.find((c) => c.id !== alloc.roomId);
              if (!pick) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
              toRoomId = pick.id;
            } else {
              const free = await freeRoomIdsFor(
                tx as unknown as RoomFinder, r.propertyId, [toRoomId], r.checkInDate, r.checkOutDate,
              );
              if (!free.has(toRoomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
            }

            await tx.roomAllocation.create({
              data: { propertyId: r.propertyId, reservationId: r.id, roomId: toRoomId, startDate: r.checkInDate, endDate: r.checkOutDate },
            });
            await tx.room.updateMany({ where: { id: alloc.roomId }, data: { status: vacatedStatus } });
            await tx.room.updateMany({ where: { id: toRoomId }, data: { status: occupiedStatus } });
            await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: alloc.roomId, propertyId: r.propertyId, payload: { to: vacatedStatus, reason: "room-move" } });
            await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: toRoomId, propertyId: r.propertyId, payload: { to: occupiedStatus, reason: "room-move" } });
            await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { movedTo: toRoomId } });
            await writeAudit(tx, {
              action: "reservation:reallocate", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
              before: { roomId: alloc.roomId }, after: { roomId: toRoomId },
            });
            return { id: r.id, status: r.status, roomId: toRoomId };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
        ),
      ),
    );
  });
}
