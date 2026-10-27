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
import { revalidatePath } from "next/cache";
import {
  ensureFolio,
  postRoomChargeTx,
  correctRoomRate,
  activeRoomNightKeys,
  nextRoomRevision,
  folioDateKey,
  type BillingPostTx,
} from "@/features/billing";
import { nights as computeNights } from "./domain/nights";
import { preTaxRatePaise } from "./domain/pricing";
import { freeRoomIdsFor, findFreeRooms, type RoomFinder } from "./availability";
import {
  assertBookingDatesValid,
  bookingAttempt,
  reservationDb,
  withReservationContext,
} from "./internal";
import { modifyReservationSchema, reallocateRoomSchema, extendStaySchema, setRoomRateSchema, changeBookingSourceSchema } from "./schema";

export type MoveResult = { id: string; status: string; roomId: string };

/**
 * Change a booking's source/channel in ANY status (03) — e.g. a guest who booked
 * via MakeMyTrip but, on arrival, cancels the OTA booking and continues directly.
 * Just updates the source (+ event + audit); revenue-by-source reports then reflect
 * the correction. No availability/money change.
 */
export async function changeBookingSource(input: unknown): Promise<Result<{ id: string; source: string }>> {
  return toResult(async () => {
    const data = changeBookingSourceSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const r = await client.reservation.findFirst({ where: { id: data.reservationId }, select: { id: true, propertyId: true, source: true } });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);
    return withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservation.update({ where: { id: r.id }, data: { source: data.source } });
        await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { field: "source", from: r.source, to: data.source } });
        await writeAudit(tx, { action: "reservation:modify", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId, before: { source: r.source }, after: { source: data.source } });
        revalidatePath(`/bookings/${r.id}`);
        return { id: r.id, source: data.source };
      }),
    );
  });
}

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
 * checked in and wants to stay longer needs this. It stretches EVERY room's
 * allocation to the new range (re-checking each room is free for the added nights),
 * updates the dates/nights, and bills the extra nights that have already elapsed
 * (property-local) onto the folio now — future nights post via the night audit.
 * Works for a single room or a multi-room group booking (all rooms move together).
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
    if (r.allocations.length === 0) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "This booking has no room to extend.", {
        publicMessage: "This booking has no room allocated, so there's nothing to extend.",
      });
    }
    const newCheckOut = data.newCheckOutDate;
    if (newCheckOut.getTime() <= r.checkOutDate.getTime()) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "The new check-out must be after the current one.", {
        publicMessage: "The new check-out must be after the current one.",
      });
    }
    // Extend keeps the ORIGINAL check-in (historical for an in-house guest), so the
    // "check-in in the past" guard must not fire — only the new check-out range is
    // validated. `allowPast` skips the New-Booking past-date rule (this isn't a new
    // booking; the "after current check-out" rule above already gates the change).
    assertBookingDatesValid({
      checkInDate: r.checkInDate, checkOutDate: newCheckOut,
      dayUseEnabled: r.property.dayUseEnabled, tz: r.property.timezone,
      allowPast: true,
    });
    const nights = computeNights(r.checkInDate, newCheckOut, r.property.timezone);
    const roomIds = r.allocations.map((a) => a.roomId);
    const roomLabel = r.allocations.map((a) => a.room?.number).filter(Boolean).join(", ");

    // An extension is routinely agreed at a DIFFERENT nightly rate. That rate
    // applies to the added nights and to everything posted from here on — never
    // retroactively, so the nights already agreed keep their price. (Re-pricing
    // the whole stay is exactly how a 6→14 Oct stay at ₹2,268 lost its agreed
    // rate when it was extended at ₹2,250.) The stored rate is PRE-TAX
    // (glossary), so back GST out of a GST-inclusive figure.
    const extensionRatePaise = data.ratePaise === undefined
      ? r.ratePaise
      : preTaxRatePaise(data.ratePaise, data.gstMode);

    // Full-stay billing: every ADDED night is billed now for an in-house guest
    // (their booked stay was posted in full at check-in, so the extension's nights
    // must be added too). A not-yet-arrived (CONFIRMED) extension posts nothing
    // now — check-in posts the whole, now-longer stay at the updated rate.
    const dayMs = 86_400_000;
    const extraNights: Date[] = [];
    for (let t = r.checkOutDate.getTime(); t < newCheckOut.getTime(); t += dayMs) {
      extraNights.push(new Date(t));
    }
    const billExtra = r.status === "IN_HOUSE";

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // Stretch EVERY room's allocation to the new check-out. We verify only the
            // ADDED slice [oldCheckOut, newCheckOut) is free — never re-check the whole
            // original range, which (after a mid-stay room move, when an allocation
            // starts later than check-in) would collide with the room's earlier occupant
            // and wrongly refuse the extension. The own allocations end exactly at
            // oldCheckOut, so they don't overlap the added slice; a plain endDate update
            // then extends them without touching the already-stayed nights.
            const free = await freeRoomIdsFor(tx as unknown as RoomFinder, r.propertyId, roomIds, r.checkOutDate, newCheckOut);
            for (const roomId of roomIds) {
              if (!free.has(roomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE, "A room isn't free for the added nights.", { publicMessage: `Room ${roomLabel || "this booking"} isn't free for the added nights.` });
            }
            await tx.roomAllocation.updateMany({ where: { reservationId: r.id }, data: { endDate: newCheckOut } });
            await tx.reservation.updateMany({
              where: { id: r.id },
              // The extension's rate becomes the booking's going-forward rate, so
              // the night audit and check-out post the remaining nights at it too.
              // Already-posted nights are deliberately left alone.
              data: { checkOutDate: newCheckOut, nights, ratePaise: extensionRatePaise },
            });

            // Bill the added nights now for an in-house guest. Idempotency keys on
            // the nights that still carry an ACTIVE room charge — a date-only check
            // counts a REVERSED night as billed and skips it, which is how a night
            // that had been reversed by a rate correction went unbilled entirely.
            if (billExtra && extraNights.length > 0 && extensionRatePaise > 0) {
              const folioId = r.folio?.id ?? (await ensureFolio(tx, { reservationId: r.id, propertyId: r.propertyId }));
              const existing = await tx.folioLine.findMany({
                where: { folioId },
                select: { id: true, type: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, businessDate: true, revision: true, reversalOfId: true },
              });
              const posted = activeRoomNightKeys(existing);
              for (const businessDate of extraNights) {
                if (posted.has(folioDateKey(businessDate))) continue;
                await postRoomChargeTx(tx as unknown as BillingPostTx, {
                  folioId,
                  propertyId: r.propertyId,
                  propertyState: r.property.state,
                  ratePaise: extensionRatePaise,
                  businessDate,
                  revision: nextRoomRevision(existing, businessDate),
                  postedById: user.userId,
                  description: `Room ${roomLabel} · night (extended)`.trim(),
                });
              }
            }

            await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { checkOutDate: newCheckOut, extended: true, ratePaise: extensionRatePaise } });
            await writeAudit(tx, {
              action: "reservation:extend", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
              before: { checkOutDate: r.checkOutDate, ratePaise: r.ratePaise },
              after: { checkOutDate: newCheckOut, nights, ratePaise: extensionRatePaise },
            });
            return { id: r.id, status: r.status, roomId: roomIds[0]! };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
        ),
      ),
    );
  });
}

/**
 * Edit a booking's nightly room rate after it's created/checked-in (03 FR-8).
 *
 * Front desk often needs to correct the per-guest rate post check-in (wrong tariff,
 * OTA/negotiated rate). This: (1) re-posts any already-charged room-nights at the
 * new rate via the proven billing correction (reverse + re-post, GST re-applied),
 * and (2) updates the reservation's `ratePaise` so future night-audit and check-out
 * postings use the new rate too — keeping the folio and the booking rate in step
 * (the drift the old folio-only "Fix room rate" left behind).
 */
export async function setRoomRate(input: unknown): Promise<Result<{ id: string; newRatePaise: number }>> {
  return toResult(async () => {
    const data = setRoomRateSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: { id: true, propertyId: true, status: true, ratePaise: true, folio: { select: { id: true } } },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);
    if (!["CONFIRMED", "IN_HOUSE", "CHECKED_OUT"].includes(r.status)) {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "This booking's room rate can't be edited.", {
        publicMessage: "This booking's room rate can't be edited.",
      });
    }

    // The booking's stored rate is PRE-TAX (glossary): back the tax out of a
    // GST-inclusive figure, otherwise the entered rate IS the taxable unit.
    const preTaxPaise = preTaxRatePaise(data.newRatePaise, data.gstMode);

    // Correct already-posted room charges to the new rate first (proven path),
    // restricted to the requested night window so a stay that legitimately holds
    // two agreed rates keeps the period that wasn't being edited. A
    // VALIDATION_FAILED means "nothing posted in that window" — fine; the rate
    // update below makes the un-accrued nights post at the new rate. Any other
    // failure aborts before the rate changes, so folio and booking never diverge.
    if (r.folio) {
      const res = await correctRoomRate({
        folioId: r.folio.id,
        newUnitPaise: preTaxPaise,
        reason: "room rate edited",
        fromNight: data.fromNight,
        toNight: data.toNight,
      });
      if (!res.ok && res.error.code !== ErrorCode.VALIDATION_FAILED) {
        throw new DomainError(res.error.code, res.error.message, { publicMessage: res.error.message });
      }
    }

    await withReservationContext(user, () =>
      client.$transaction(async (tx) => {
        await tx.reservation.updateMany({ where: { id: r.id }, data: { ratePaise: preTaxPaise } });
        await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: r.propertyId, payload: { ratePaise: preTaxPaise, rateEdited: true } });
        await writeAudit(tx, {
          action: "reservation:set-rate", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
          before: { ratePaise: r.ratePaise }, after: { ratePaise: preTaxPaise, gstMode: data.gstMode },
        });
      }),
    );

    revalidatePath(`/bookings/${r.id}`);
    revalidatePath(`/bookings/${r.id}/folio`);
    return { id: r.id, newRatePaise: preTaxPaise };
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
        property: { select: { timezone: true } },
        allocations: { select: { id: true, roomId: true, startDate: true, room: { select: { number: true, categoryId: true } } } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId);

    if (r.status !== "IN_HOUSE" && r.status !== "CONFIRMED") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Only a confirmed or in-house booking's room can be changed.", {
        publicMessage: "Only a confirmed or in-house booking's room can be changed.",
      });
    }
    if (r.allocations.length === 0) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "This booking has no room to move.", {
        publicMessage: "This booking has no room allocated to move.",
      });
    }
    // Which room to move: the only one, or (for a group booking) the caller-named room.
    const alloc = data.fromRoomId
      ? r.allocations.find((a) => a.roomId === data.fromRoomId)
      : r.allocations.length === 1
        ? r.allocations[0]
        : undefined;
    if (!alloc) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Pick which room of this booking to move.", {
        publicMessage: "This booking has several rooms — choose which one to move.",
      });
    }
    // Room statuses depend on whether the guest is already in-house.
    const [vacatedStatus, occupiedStatus] =
      r.status === "IN_HOUSE" ? (["HOUSEKEEPING", "OCCUPIED"] as const) : (["VACANT", "RESERVED"] as const);

    // Window = the nights STILL TO COME, in PROPERTY-LOCAL time. An in-house guest who
    // has already stayed some nights only needs the new room free from today onward —
    // the past nights stay attributed to the old room (so a room occupied earlier in
    // the stay but free now can still receive the guest). "Today" is the property's
    // local day (reception working after midnight IST must not jump a day). A stay with
    // no nights left (ended / overstaying) can't be moved — it must be extended first.
    const todayStr = r.property.timezone
      ? new Date().toLocaleDateString("en-CA", { timeZone: r.property.timezone })
      : new Date().toISOString().slice(0, 10);
    const todayDate = new Date(`${todayStr}T00:00:00.000Z`);
    if (todayDate.getTime() >= r.checkOutDate.getTime()) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "No remaining nights to move.", {
        publicMessage: "This stay has no remaining nights to move — extend the stay first.",
      });
    }
    const windowStart = todayDate.getTime() > r.checkInDate.getTime() ? todayDate : r.checkInDate;
    // Shorten (keep the already-stayed nights in the old room) only when the guest is
    // in-house AND the old room's allocation actually has a pre-window portion; else drop.
    const shortenOld = r.status === "IN_HOUSE" && windowStart.getTime() > alloc.startDate.getTime();

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            if (shortenOld) {
              await tx.roomAllocation.updateMany({ where: { id: alloc.id }, data: { endDate: windowStart } });
            } else {
              await tx.roomAllocation.deleteMany({ where: { id: alloc.id } });
            }

            // Resolve the target: explicit, or the first free same-category room —
            // free for the REMAINING window (windowStart → checkout).
            let toRoomId = data.toRoomId;
            if (!toRoomId) {
              const candidates = await findFreeRooms(tx as unknown as RoomFinder, {
                propertyId: r.propertyId, categoryId: alloc.room.categoryId,
                checkInDate: windowStart, checkOutDate: r.checkOutDate,
              });
              const pick = candidates.find((c) => c.id !== alloc.roomId);
              if (!pick) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
              toRoomId = pick.id;
            } else {
              const free = await freeRoomIdsFor(
                tx as unknown as RoomFinder, r.propertyId, [toRoomId], windowStart, r.checkOutDate,
              );
              if (!free.has(toRoomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);
            }

            await tx.roomAllocation.create({
              data: { propertyId: r.propertyId, reservationId: r.id, roomId: toRoomId, startDate: windowStart, endDate: r.checkOutDate },
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
