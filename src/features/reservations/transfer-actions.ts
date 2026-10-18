"use server";

/**
 * Cross-property transfer (03) — shift an IN_HOUSE guest to another property
 * mid-stay (e.g. their room is booked from tomorrow, but they want to stay on).
 *
 * A single booking can't span two properties: rates, GST (per-property GSTIN /
 * state) and gap-free invoice numbering are all per-property (business-rules
 * §10-13). So a transfer is modelled as TWO linked stays, each billed correctly on
 * its own folio:
 *   • Origin (property A): checked out on the transfer date; its elapsed room-nights
 *     are posted so its folio/GST is complete.
 *   • Continuation (property B): a new IN_HOUSE booking transferDate → newCheckOut,
 *     its own room/rate/folio, `transferredFromId` pointing back to the origin.
 * The guest is shown ONE combined statement at checkout (06); the books stay per
 * property. Everything runs in one SERIALIZABLE transaction — either the whole
 * shift lands or nothing does.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import {
  ensureFolio,
  postRoomChargeTx,
  activeLines,
  activeRoomNightKeys,
  nextRoomRevision,
  type BillingPostTx,
} from "@/features/billing";
import { nights as computeNights } from "./domain/nights";
import { freeRoomIdsFor, type RoomFinder } from "./availability";
import {
  bookingAttempt,
  generateReservationCode,
  isUniqueViolation,
  reservationDb,
  withReservationContext,
} from "./internal";
import { transferPropertySchema, relocatePropertySchema } from "./schema";

export type TransferResult = { originId: string; newId: string; newCode: string };
export type RelocateResult = { id: string; code: string; toPropertyId: string; toRoomId: string };

const dateKey = (d: Date): string => d.toISOString().slice(0, 10);
/** Business-date list [from, to) — one entry per night. */
function nightDates(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const day = 86_400_000;
  for (let t = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t < to.getTime(); t += day) {
    out.push(new Date(t));
  }
  return out;
}

export async function transferToProperty(input: unknown): Promise<Result<TransferResult>> {
  return toResult(async () => {
    const data = transferPropertySchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true, code: true, propertyId: true, status: true, source: true, guestId: true,
        checkInDate: true, checkOutDate: true, ratePaise: true, adults: true, children: true,
        allocations: { select: { id: true, roomId: true } },
        folio: { select: { id: true } },
        property: { select: { timezone: true, state: true } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId); // move out of origin
    authorize(user, "reservation:create", data.toPropertyId); // create at destination

    if (r.status !== "IN_HOUSE") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Only an in-house guest can be transferred.", {
        publicMessage: "Only an in-house guest can be transferred to another property.",
      });
    }
    if (r.allocations.length !== 1) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Group bookings can't be transferred in one step.", {
        publicMessage: "Group bookings can't be transferred in one step.",
      });
    }
    if (data.toPropertyId === r.propertyId) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Same property — use room move instead.", {
        publicMessage: "That's the same property. To change room within a property, use Move room instead.",
      });
    }

    const transferDate = data.transferDate;
    const newCheckOut = data.newCheckOutDate;
    if (dateKey(transferDate) <= dateKey(r.checkInDate)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Transfer date must be after check-in.", {
        publicMessage: "The transfer date must be after the guest's original check-in.",
      });
    }
    if (dateKey(newCheckOut) <= dateKey(transferDate)) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "New check-out must be after the transfer date.", {
        publicMessage: "The new check-out must be at least one night after the transfer date.",
      });
    }

    const toProp = await client.property.findFirst({ where: { id: data.toPropertyId }, select: { state: true, timezone: true } });
    if (!toProp) throw new NotFoundError("Destination property not found.");

    const nightsA = computeNights(r.checkInDate, transferDate, r.property.timezone);
    const nightsB = computeNights(transferDate, newCheckOut, toProp.timezone);
    const originRoomId = r.allocations[0]!.roomId;

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // ---- Close the origin stay on the transfer date --------------------
            const folioAId = r.folio?.id ?? (await ensureFolio(tx as never, { reservationId: r.id, propertyId: r.propertyId }));
            await tx.roomAllocation.updateMany({ where: { id: r.allocations[0]!.id }, data: { endDate: transferDate } });

            const linesA = await tx.folioLine.findMany({
              where: { folioId: folioAId },
              select: { id: true, type: true, description: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true },
            });

            // The origin's WHOLE booked stay was posted at check-in (full-stay
            // billing), so every night from the transfer date onward now belongs to
            // the destination — and was being billed TWICE, once on each folio. A
            // transfer IS an early departure from the origin, so reverse those
            // nights exactly as `checkOut` does; otherwise a 5-night journey split
            // 2 + 3 bills 8 nights. ("Transfer karein to rate minus bhi hona chahiye.")
            for (const l of activeLines(linesA)) {
              if (l.type !== "ROOM" || dateKey(l.businessDate) < dateKey(transferDate)) continue;
              await tx.folioLine.create({
                data: {
                  folioId: folioAId, type: "REVERSAL",
                  description: `Reversal: ${l.description} (transferred to another property)`,
                  quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise,
                  taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
                  hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
                  businessDate: new Date(), reversalOfId: l.id, postedById: user.userId,
                },
                select: { id: true },
              });
            }

            // Then make sure every night actually STAYED at the origin is billed.
            // Keys on the nights still carrying an ACTIVE charge, so a night
            // reversed earlier (by a rate correction) is re-billed, not skipped.
            const postedA = activeRoomNightKeys(linesA);
            for (const bd of nightDates(r.checkInDate, transferDate)) {
              if (!postedA.has(dateKey(bd)) && r.ratePaise > 0) {
                await postRoomChargeTx(tx as unknown as BillingPostTx, {
                  folioId: folioAId, propertyId: r.propertyId, propertyState: r.property.state,
                  ratePaise: r.ratePaise, businessDate: bd,
                  revision: nextRoomRevision(linesA, bd), postedById: user.userId,
                });
              }
            }

            const flipped = await tx.reservation.updateMany({
              where: { id: r.id, status: "IN_HOUSE" },
              data: { checkOutDate: transferDate, nights: nightsA, status: "CHECKED_OUT", checkOutAt: new Date() },
            });
            if (flipped.count !== 1) throw new DomainError(ErrorCode.CONFLICT, "This booking is no longer available to transfer.");
            await tx.room.updateMany({ where: { id: originRoomId }, data: { status: "HOUSEKEEPING" } });
            await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: originRoomId, propertyId: r.propertyId, payload: { to: "HOUSEKEEPING", reason: "transfer-out" } });
            await emitEvent(tx, { type: "GuestCheckedOut", aggregateId: r.id, propertyId: r.propertyId, payload: { code: r.code, transferred: true } });

            // ---- Open the continuation stay at the destination -----------------
            // Verify the destination room is free for the continuation range.
            const free = await freeRoomIdsFor(tx as unknown as RoomFinder, data.toPropertyId, [data.toRoomId], transferDate, newCheckOut);
            if (!free.has(data.toRoomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);

            let created: { id: string; code: string } | null = null;
            for (let attempt = 0; attempt < 3 && !created; attempt++) {
              try {
                created = await tx.reservation.create({
                  data: {
                    propertyId: data.toPropertyId, code: generateReservationCode(), guestId: r.guestId,
                    status: "IN_HOUSE", source: r.source, checkInDate: transferDate, checkOutDate: newCheckOut,
                    checkInAt: new Date(), nights: nightsB, adults: r.adults, children: r.children,
                    ratePaise: data.ratePaise, transferredFromId: r.id,
                  },
                  select: { id: true, code: true },
                });
              } catch (e) {
                if (isUniqueViolation(e) && attempt < 2) continue;
                throw e;
              }
            }
            if (!created) throw new DomainError(ErrorCode.CONFLICT, "Could not allocate a booking code.");

            await tx.roomAllocation.create({
              data: { propertyId: data.toPropertyId, reservationId: created.id, roomId: data.toRoomId, startDate: transferDate, endDate: newCheckOut },
            });
            await tx.room.updateMany({ where: { id: data.toRoomId }, data: { status: "OCCUPIED" } });
            await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: data.toRoomId, propertyId: data.toPropertyId, payload: { to: "OCCUPIED", reason: "transfer-in", reservationId: created.id } });

            // Full-stay billing, the same policy check-in applies: the continuation
            // posts EVERY booked night now, so reception sees the whole amount owed
            // at the destination instead of a part-bill that grows silently. (Only
            // the elapsed nights used to post, which is why staff hand-posted the
            // missing nights as ad-hoc "1 day stay more" charges.) Leaving early
            // reverses the unused nights through the normal check-out path.
            const folioBId = await ensureFolio(tx as never, { reservationId: created.id, propertyId: data.toPropertyId });
            for (const bd of nightDates(transferDate, newCheckOut)) {
              if (data.ratePaise > 0) {
                await postRoomChargeTx(tx as unknown as BillingPostTx, {
                  folioId: folioBId, propertyId: data.toPropertyId, propertyState: toProp.state,
                  ratePaise: data.ratePaise, businessDate: bd, postedById: user.userId,
                });
              }
            }

            await emitEvent(tx, { type: "ReservationCreated", aggregateId: created.id, propertyId: data.toPropertyId, payload: { code: created.code, transferredFromId: r.id } });
            await emitEvent(tx, { type: "GuestCheckedIn", aggregateId: created.id, propertyId: data.toPropertyId, payload: { code: created.code, transferred: true } });
            await writeAudit(tx, {
              action: "reservation:transfer", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
              after: { toPropertyId: data.toPropertyId, toRoomId: data.toRoomId, transferDate: dateKey(transferDate), newReservationId: created.id },
            });

            return { originId: r.id, newId: created.id, newCode: created.code };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
        ),
      ),
    );
  });
}

/**
 * Relocate a NOT-YET-ARRIVED booking to another property (03).
 *
 * The guest booked property A but, on arrival (or beforehand), wants property B —
 * they never stayed at A, so this is NOT a split: the SAME booking just moves.
 * The origin room is released, a chosen free room at B is allocated, the folio
 * (with any advance already taken) follows to B, and dates/guest/source are kept.
 * Only an ENQUIRY/CONFIRMED booking with NO posted charges may move (posted GST
 * lines carry the origin's place-of-supply; a stay with charges must transfer
 * mid-stay instead). Reception then runs the normal check-in flow at B.
 */
export async function relocateBeforeCheckIn(input: unknown): Promise<Result<RelocateResult>> {
  return toResult(async () => {
    const data = relocatePropertySchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);

    const r = await client.reservation.findFirst({
      where: { id: data.reservationId },
      select: {
        id: true, code: true, propertyId: true, status: true, ratePaise: true,
        checkInDate: true, checkOutDate: true,
        allocations: { select: { id: true, roomId: true } },
        folio: { select: { id: true, lines: { select: { id: true }, take: 1 } } },
      },
    });
    if (!r) throw new NotFoundError("Reservation not found.");
    authorize(user, "reservation:modify", r.propertyId); // move out of origin
    authorize(user, "reservation:create", data.toPropertyId); // place at destination

    if (r.status !== "CONFIRMED" && r.status !== "ENQUIRY") {
      throw new DomainError(ErrorCode.ILLEGAL_TRANSITION, "Only a not-yet-arrived booking can be relocated.", {
        publicMessage: "This guest has already checked in — use Transfer to another property instead.",
      });
    }
    if (data.toPropertyId === r.propertyId) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Same property.", {
        publicMessage: "That's the same property. To change room within a property, use Move room instead.",
      });
    }
    if (r.folio && r.folio.lines.length > 0) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, "Folio already has charges.", {
        publicMessage: "This booking already has charges posted and can't be relocated. Transfer mid-stay instead.",
      });
    }

    const toProp = await client.property.findFirst({ where: { id: data.toPropertyId }, select: { id: true } });
    if (!toProp) throw new NotFoundError("Destination property not found.");
    const originRoomId = r.allocations[0]?.roomId ?? null;
    const newRatePaise = data.ratePaise ?? r.ratePaise;

    return withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // Verify the destination room is free for the (unchanged) stay range.
            const free = await freeRoomIdsFor(tx as unknown as RoomFinder, data.toPropertyId, [data.toRoomId], r.checkInDate, r.checkOutDate);
            if (!free.has(data.toRoomId)) throw new DomainError(ErrorCode.ROOM_UNAVAILABLE);

            // Re-point the booking; code stays the same unless it collides at B.
            const moved = await tx.reservation.updateMany({
              where: { id: r.id, status: r.status },
              data: { propertyId: data.toPropertyId, ratePaise: newRatePaise },
            });
            if (moved.count !== 1) throw new DomainError(ErrorCode.CONFLICT, "This booking is no longer available to relocate.");

            // Release the origin room, re-allocate at the destination.
            await tx.roomAllocation.deleteMany({ where: { reservationId: r.id } });
            await tx.roomAllocation.create({
              data: { propertyId: data.toPropertyId, reservationId: r.id, roomId: data.toRoomId, startDate: r.checkInDate, endDate: r.checkOutDate },
            });
            if (originRoomId) {
              await tx.room.updateMany({ where: { id: originRoomId }, data: { status: "VACANT" } });
              await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: originRoomId, propertyId: r.propertyId, payload: { to: "VACANT", reason: "relocate-out" } });
            }
            await tx.room.updateMany({ where: { id: data.toRoomId }, data: { status: "RESERVED" } });
            await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: data.toRoomId, propertyId: data.toPropertyId, payload: { to: "RESERVED", reason: "relocate-in", reservationId: r.id } });

            // The folio (and any advance already on it) follows the booking to B.
            if (r.folio) await tx.folio.updateMany({ where: { id: r.folio.id }, data: { propertyId: data.toPropertyId } });

            await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: data.toPropertyId, payload: { relocatedFromPropertyId: r.propertyId, toRoomId: data.toRoomId } });
            await writeAudit(tx, {
              action: "reservation:relocate", entityType: "Reservation", entityId: r.id, propertyId: data.toPropertyId,
              before: { propertyId: r.propertyId, roomId: originRoomId, ratePaise: r.ratePaise },
              after: { propertyId: data.toPropertyId, roomId: data.toRoomId, ratePaise: newRatePaise },
            });

            return { id: r.id, code: r.code, toPropertyId: data.toPropertyId, toRoomId: data.toRoomId };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 15_000 },
        ),
      ),
    );
  });
}
