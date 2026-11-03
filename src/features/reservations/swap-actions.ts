"use server";

/**
 * Swap rooms between two bookings (client, 3 Nov 2026): the guest at the desk
 * (not checked in) takes the room(s) another guest is booked into, and that guest
 * — who must not be in-house — gets this guest's room(s). Like for like: single
 * room ↔ single room, 2 BHK ↔ 2 BHK (same number of rooms; the whole unit moves).
 * Works across properties — each booking (and its folio, with any advance) then
 * belongs to the other property. Each guest keeps their own dates and agreed rate.
 *
 * One SERIALIZABLE transaction: both units are released, every new room is
 * re-checked free for its new guest's dates (allocations + blocks), and the
 * `room_no_overlap` constraint is the backstop — a swap can never overbook.
 * Validate → authorize (both properties) → transaction → events → audit.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { decryptOptional } from "@/lib/crypto/encryption";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { freeRoomIdsFor, type RoomFinder } from "./availability";
import { bookingAttempt, reservationDb, withReservationContext } from "./internal";
import { swapProblem, type SwapSide } from "./domain/swap";

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

export type SwapResult = { a: { code: string; room: string; property: string }; b: { code: string; room: string; property: string } };

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
    const problem = swapProblem(side(a), side(b));
    if (problem) throw new DomainError(ErrorCode.VALIDATION_FAILED, problem, { publicMessage: problem });

    const crossProperty = a.propertyId !== b.propertyId;
    const rooms = (r: typeof a) => r.allocations.map((x) => x.room.number).join(" + ");

    const result = await withReservationContext(user, () =>
      bookingAttempt(() =>
        client.$transaction(
          async (tx) => {
            // Release both units, then every new room must be free for its new guest's dates.
            await tx.roomAllocation.deleteMany({ where: { id: { in: [...a.allocations, ...b.allocations].map((x) => x.id) } } });
            const pairs = [[a, b], [b, a]] as const;
            for (const [guest, unit] of pairs) {
              const ids = unit.allocations.map((x) => x.roomId);
              const free = await freeRoomIdsFor(tx as unknown as RoomFinder, unit.propertyId, ids, guest.checkInDate, guest.checkOutDate);
              const taken = unit.allocations.filter((x) => !free.has(x.roomId)).map((x) => x.room.number);
              if (taken.length) {
                const msg = `Room ${taken.join(", ")} isn't free for ${guest.guest.fullName}'s dates (${ymd(guest.checkInDate)} → ${ymd(guest.checkOutDate)}) — another booking or a block holds it.`;
                throw new DomainError(ErrorCode.ROOM_UNAVAILABLE, msg, { publicMessage: msg });
              }
            }

            // Re-point each booking (and its folio, with any advance) when the units are
            // in different properties; compare-and-swap on the status so a concurrent
            // check-in can't be swapped underneath.
            for (const [r, other] of pairs) {
              const n = await tx.reservation.updateMany({
                where: { id: r.id, status: r.status },
                data: crossProperty ? { propertyId: other.propertyId } : { updatedAt: new Date() },
              });
              if (n.count !== 1) throw new DomainError(ErrorCode.CONFLICT, `${r.code} changed meanwhile — try again.`, { publicMessage: `${r.code} changed meanwhile — try again.` });
              if (crossProperty && r.folio) await tx.folio.updateMany({ where: { id: r.folio.id }, data: { propertyId: other.propertyId } });
            }
            for (const [r, other] of pairs) {
              for (const x of other.allocations) {
                await tx.roomAllocation.create({ data: { propertyId: other.propertyId, reservationId: r.id, roomId: x.roomId, startDate: r.checkInDate, endDate: r.checkOutDate } });
              }
            }

            for (const [r, other] of pairs) {
              await emitEvent(tx, { type: "ReservationModified", aggregateId: r.id, propertyId: other.propertyId, payload: { swappedWith: other.id, fromRooms: rooms(r), toRooms: rooms(other), ...(crossProperty ? { fromPropertyId: r.propertyId } : {}) } });
              await writeAudit(tx, {
                action: "reservation:swap-room", entityType: "Reservation", entityId: r.id, propertyId: other.propertyId, reason: data.reason ?? null,
                before: { rooms: rooms(r), propertyId: r.propertyId },
                after: { rooms: rooms(other), propertyId: other.propertyId, swappedWith: other.code, otherGuest: other.guest.fullName },
              });
            }
            return {
              a: { code: a.code, room: rooms(b), property: b.property.name },
              b: { code: b.code, room: rooms(a), property: a.property.name },
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
 * Bookings this one could swap with: not checked in, no charges, no split stay,
 * the SAME number of rooms (single ↔ single, 2 BHK ↔ 2 BHK), still to come, in any
 * property the user can manage. The swap itself re-checks everything. The other
 * guest is shown in full (name, code, masked mobile, rooms, dates) so staff know
 * exactly whose room they are giving away.
 */
export async function swapCandidates(reservationId: string): Promise<Result<SwapCandidate[]>> {
  return toResult(async () => {
    const user = await requireUser();
    const client = reservationDb(user);
    const self = await client.reservation.findFirst({ where: { id: reservationId }, select: { propertyId: true, _count: { select: { allocations: true } } } });
    if (!self) throw new NotFoundError("Booking not found.");
    authorize(user, "reservation:modify", self.propertyId);
    const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00.000Z`);
    const rows = await client.reservation.findMany({
      where: { id: { not: reservationId }, status: { in: ["CONFIRMED", "ENQUIRY"] }, checkOutDate: { gt: today } },
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
      .filter((r) => r.allocations.length === self._count.allocations && !(r.folio && r.folio.lines.length > 0))
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
