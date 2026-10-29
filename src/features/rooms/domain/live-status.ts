/**
 * A room's status on the board, DERIVED from bookings — pure, no I/O.
 *
 * The stored `room.status` drifted from reality (a future booking marked a room
 * "Reserved" tonight, a cancellation marked an occupied room "Vacant", a Data-Entry
 * stay never flipped it). So the board now asks the bookings:
 *   occupied  ← an in-house guest's allocation covers today (or ends today and the
 *               guest hasn't checked out yet);
 *   reserved  ← a confirmed guest is due today (arrival not yet checked in);
 * and keeps from the stored status only what bookings can't know: out of order
 * and "needs cleaning".
 */
import type { RoomStatus } from "@prisma/client";

export type LiveInputs = {
  stored: RoomStatus;
  blockedToday: boolean;
  occupiedToday: boolean;
  arrivingToday: boolean;
};

export function liveRoomStatus(i: LiveInputs): RoomStatus {
  if (i.occupiedToday) return "OCCUPIED";
  if (i.blockedToday || i.stored === "UNDER_MAINTENANCE") return "UNDER_MAINTENANCE";
  if (i.stored === "HOUSEKEEPING") return "HOUSEKEEPING";
  if (i.arrivingToday) return "RESERVED";
  return "VACANT";
}

export type RoomAllocationFact = {
  roomId: string;
  startDate: Date;
  endDate: Date;
  reservation: { id: string; code: string; status: string; checkOutDate: Date; guestName: string | null };
};

export type RoomDay = {
  occupant: RoomAllocationFact | null;
  arrival: RoomAllocationFact | null;
  departingToday: boolean;
  next: RoomAllocationFact | null;
};

/**
 * What one room's allocations say about `today` (a UTC-midnight date holding the
 * property-local day). Allocations are half-open [start, end).
 */
export function roomDay(allocs: RoomAllocationFact[], today: Date): RoomDay {
  const t = today.getTime();
  const covers = (a: RoomAllocationFact) => a.startDate.getTime() <= t && a.endDate.getTime() > t;
  const inHouse = allocs.filter((a) => a.reservation.status === "IN_HOUSE");
  // Due out today and not yet checked out: the allocation ended at today but the
  // guest is still in the room until check-out.
  const dueOut = inHouse.find((a) => a.endDate.getTime() === t && a.reservation.checkOutDate.getTime() === t) ?? null;
  const occupant = inHouse.find(covers) ?? dueOut;
  const arrival = allocs.find((a) => a.reservation.status === "CONFIRMED" && covers(a)) ?? null;
  const next =
    allocs
      .filter((a) => (a.reservation.status === "CONFIRMED" || a.reservation.status === "ENQUIRY") && a.startDate.getTime() > t)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0] ?? null;
  return { occupant, arrival, departingToday: !!dueOut, next };
}
