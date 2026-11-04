"use server";

/**
 * Swap rooms between two bookings (client, 3–4 Nov 2026). Guest A takes the
 * room(s) Guest B is booked into, and B — who must not be in-house — gets A's
 * room(s). Like for like: single room ↔ single room, 2 BHK ↔ 2 BHK (same number
 * of rooms; the whole unit moves). Each guest keeps their own dates and rate.
 *  - A not checked in: works across properties — each booking (and its folio,
 *    with any advance) then belongs to the other property.
 *  - A already in-house: A moves into B's unit FROM TODAY (the nights already
 *    stayed stay in the old room; old room → cleaning, new room → occupied), B gets
 *    A's unit for B's dates. Same property only (another property = Transfer).
 *
 * One SERIALIZABLE transaction: units are released, every new room is re-checked
 * free for its new guest's dates (allocations + blocks), and the `room_no_overlap`
 * constraint is the backstop — a swap can never overbook.
 * Validate → authorize (both properties) → transaction → events → audit.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { decryptOptional } from "@/lib/crypto/encryption";
import { localToday } from "@/lib/local-day";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { freeRoomIdsFor, type RoomFinder } from "./availability";
import { bookingAttempt, reservationDb, withReservationContext } from "./internal";
import { currentUnit, swapProblem, type SwapSide } from "./domain/swap";

const swapSchema = z.object({
  reservationId: z.string().min(1),
  otherReservationId: z.string().min(1),
  reason: z.string().trim().max(200).optional(),
});

const SIDE_SELECT = {
  id: true, code: true, status: true, propertyId: true, checkInDate: true, checkOutDate: true,
  guest: { select: { fullName: true } },
  property: { select: { name: true } },
  allocations: { select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { number: true } } }, orderBy: { room: { number: "asc" } } },
  folio: { select: { id: true, lines: { select: { id: true }, take: 1 } } },
} as const;

export type SwapResult = { a: { code: string; room: string; property: string; from: string }; b: { code: string; room: string; property: string } };

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function swapRooms(input: unknown): Promise<Result<SwapResult>> {
  return toResult(async () => {
    const data = swapSchema.parse(input);
    const user = await requireUser();
    const client = reservationDb(user);
    const [a, b] = await Promise.all([
      client.reservation.findFirst({ where: { id: data.reservationId }, select: SIDE_SELECT }),
      client.reservation.findFirst({ where: { id: data.otherReservationId }, select: SIDE_SELECT }),
    ]);
    if (!a || !b) throw new NotFoundError("Booking not found.");
    authorize(user, "reservation:modify", a.propertyId);
    authorize(user, "reservation:modify", b.propertyId);

    const side = (r: typeof a): SwapSide => ({
      id: r.id, code: r.code, status: r.status, propertyId: r.propertyId, checkInDate: r.checkInDate, checkOutDate: r.checkOutDate,
      allocations: r.allocations, chargesPosted: !!r.folio && r.folio.lines.length > 0,
    });
    const today = localToday();
    const problem = swapProblem(side(a), side(b), today);
    if (problem) throw new DomainError(ErrorCode.VALIDATION_FAILED, problem, { publicMessage: problem });

    const aInHouse = a.status === "IN_HOUSE";
    const crossProperty = a.propertyId !== b.propertyId; // never for an in-house A (refused above)
    // What each side gives up: an in-house guest gives up the room(s) they're in now.
    const aUnit = aInHouse ? currentUnit(a) : a.allocations;
    const bUnit = b.allocations;
    // An in-house guest moves from today; the nights already stayed stay in the old room.
    const aFrom = aInHouse ? new Date(Math.max(today.getTime(), a.checkInDate.getTime())) : a.checkInDate;
    const label = (u: typeof bUnit) => u.map((x) => x.room.number).join(" + ");

    const result = await withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // Release B's unit; A's unit is released from `aFrom` (kept for nights already stayed).
            await tx.roomAllocation.deleteMany({ where: { id: { in: bUnit.map((x) => x.id) } } });
            for (const x of aUnit) {
              if (aInHouse && x.startDate.getTime() < aFrom.getTime()) {
                await tx.roomAllocation.updateMany({ where: { id: x.id }, data: { endDate: aFrom } });
              } else {
                await tx.roomAllocation.deleteMany({ where: { id: x.id } });
              }
            }
            // Every new room must be free for its new guest's (remaining) dates.
            const checks = [
              { guest: a, unit: bUnit, prop: b.propertyId, from: aFrom, to: a.checkOutDate },
              { guest: b, unit: aUnit, prop: a.propertyId, from: b.checkInDate, to: b.checkOutDate },
            ];
            for (const c of checks) {
              const free = await freeRoomIdsFor(tx as unknown as RoomFinder, c.prop, c.unit.map((x) => x.roomId), c.from, c.to);
              const taken = c.unit.filter((x) => !free.has(x.roomId)).map((x) => x.room.number);
              if (taken.length) {
                const msg = `Room ${taken.join(", ")} isn't free for ${c.guest.guest.fullName}'s dates (${ymd(c.from)} → ${ymd(c.to)}) — another booking or a block holds it.`;
                throw new DomainError(ErrorCode.ROOM_UNAVAILABLE, msg, { publicMessage: msg });
              }
            }

            // Re-point each booking (and its folio, with any advance) when the units are
            // in different properties; compare-and-swap on the status so a concurrent
            // check-in / check-out can't be swapped underneath.
            for (const [r, other] of [[a, b], [b, a]] as const) {
              const n = await tx.reservation.updateMany({
                where: { id: r.id, status: r.status },
                data: crossProperty ? { propertyId: other.propertyId } : { updatedAt: new Date() },
              });
              if (n.count !== 1) throw new DomainError(ErrorCode.CONFLICT, `${r.code} changed meanwhile — try again.`, { publicMessage: `${r.code} changed meanwhile — try again.` });
              if (crossProperty && r.folio) await tx.folio.updateMany({ where: { id: r.folio.id }, data: { propertyId: other.propertyId } });
            }
            for (const x of bUnit) {
              await tx.roomAllocation.create({ data: { propertyId: b.propertyId, reservationId: a.id, roomId: x.roomId, startDate: aFrom, endDate: a.checkOutDate } });
            }
            for (const x of aUnit) {
              await tx.roomAllocation.create({ data: { propertyId: a.propertyId, reservationId: b.id, roomId: x.roomId, startDate: b.checkInDate, endDate: b.checkOutDate } });
            }

            // An in-house guest physically moves: the room they leave needs cleaning,
            // the room they enter is occupied.
            if (aInHouse) {
              const moves: [string[], "HOUSEKEEPING" | "OCCUPIED"][] = [[aUnit.map((x) => x.roomId), "HOUSEKEEPING"], [bUnit.map((x) => x.roomId), "OCCUPIED"]];
              for (const [ids, to] of moves) {
                await tx.room.updateMany({ where: { id: { in: ids } }, data: { status: to } });
                for (const roomId of ids) {
                  await emitEvent(tx, { type: "RoomStatusChanged", aggregateId: roomId, propertyId: a.propertyId, payload: { to, reason: "room-swap", reservationId: a.id } });
                }
              }
            }

            const sides = [
              { r: a, other: b, from: aUnit, to: bUnit, extra: aInHouse ? { inHouseFrom: ymd(aFrom) } : {} },
              { r: b, other: a, from: bUnit, to: aUnit, extra: {} },
            ];
            for (const s of sides) {
              await emitEvent(tx, { type: "ReservationModified", aggregateId: s.r.id, propertyId: s.other.propertyId, payload: { swappedWith: s.other.id, fromRooms: label(s.from), toRooms: label(s.to), ...(crossProperty ? { fromPropertyId: s.r.propertyId } : {}), ...s.extra } });
              await writeAudit(tx, {
                action: "reservation:swap-room", entityType: "Reservation", entityId: s.r.id, propertyId: s.other.propertyId, reason: data.reason ?? null,
                before: { rooms: label(s.from), propertyId: s.r.propertyId },
                after: { rooms: label(s.to), propertyId: s.other.propertyId, swappedWith: s.other.code, otherGuest: s.other.guest.fullName, ...s.extra },
              });
            }
            return {
              a: { code: a.code, room: label(bUnit), property: b.property.name, from: ymd(aFrom) },
              b: { code: b.code, room: label(aUnit), property: a.property.name },
            };
          },
          { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 },
        ),
      ),
    );
    revalidatePath(`/bookings/${a.id}`);
    revalidatePath(`/bookings/${b.id}`);
    revalidatePath("/rooms");
    return result;
  });
}

export type SwapCandidate = {
  id: string; code: string; guestName: string; maskedMobile: string | null; status: string; source: string;
  propertyName: string; rooms: string; roomCount: number; checkIn: string; checkOut: string; nights: number; adults: number;
};

/**
 * Bookings this one could swap with (an in-house guest: same property only): not
 * checked in, no charges, no split stay, the SAME number of rooms (single ↔
 * single, 2 BHK ↔ 2 BHK), still to come, in any property the user can manage. The
 * swap itself re-checks everything. The other guest is shown in full (name, code,
 * masked mobile, rooms, dates) so staff know exactly whose room they are taking.
 */
export async function swapCandidates(reservationId: string): Promise<Result<SwapCandidate[]>> {
  return toResult(async () => {
    const user = await requireUser();
    const client = reservationDb(user);
    const self = await client.reservation.findFirst({
      where: { id: reservationId },
      select: { propertyId: true, status: true, checkOutDate: true, allocations: { select: { startDate: true, endDate: true } } },
    });
    if (!self) throw new NotFoundError("Booking not found.");
    authorize(user, "reservation:modify", self.propertyId);
    const today = localToday();
    // An in-house guest swaps their CURRENT unit, within their own property.
    const inHouse = self.status === "IN_HOUSE";
    const unitSize = inHouse ? currentUnit(self).length : self.allocations.length;
    const rows = await client.reservation.findMany({
      where: { id: { not: reservationId }, status: { in: ["CONFIRMED", "ENQUIRY"] }, checkOutDate: { gt: today }, ...(inHouse ? { propertyId: self.propertyId } : {}) },
      select: {
        id: true, code: true, status: true, source: true, checkInDate: true, checkOutDate: true, nights: true, adults: true,
        guest: { select: { fullName: true, mobile: true } }, property: { select: { name: true } },
        allocations: { select: { startDate: true, endDate: true, room: { select: { number: true } } }, orderBy: { room: { number: "asc" } } },
        folio: { select: { lines: { select: { id: true }, take: 1 } } },
      },
      orderBy: { checkInDate: "asc" },
      take: 400,
    });
    return rows
      .filter((r) => r.allocations.length === unitSize && !(r.folio && r.folio.lines.length > 0))
      .filter((r) => r.allocations.every((x) => x.startDate.getTime() === r.checkInDate.getTime() && x.endDate.getTime() === r.checkOutDate.getTime()))
      .map((r) => ({
        id: r.id, code: r.code, guestName: r.guest.fullName, maskedMobile: maskMobile(decryptOptional(r.guest.mobile)), status: r.status, source: r.source,
        propertyName: r.property.name, rooms: r.allocations.map((x) => x.room.number).join(" + "), roomCount: r.allocations.length,
        checkIn: ymd(r.checkInDate), checkOut: ymd(r.checkOutDate), nights: r.nights, adults: r.adults,
      }));
  });
}

/** "98•••••210" — enough for reception to recognise the guest, no more. */
function maskMobile(m: string | null): string | null {
  if (!m) return null;
  const digits = m.replace(/\D/g, "");
  return digits.length >= 6 ? `${digits.slice(0, 2)}${"•".repeat(digits.length - 5)}${digits.slice(-3)}` : null;
}
