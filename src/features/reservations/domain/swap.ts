/**
 * Room swap between two bookings — pure checks (no I/O).
 *
 * Guest A (at the desk, not checked in) wants the room(s) Guest B is booked into.
 * A takes ALL of B's rooms for A's own dates and B takes all of A's rooms for B's
 * own dates — across properties too. Like for like only: a single room swaps with
 * a single room, a 2-room (2 BHK) unit with a 2-room unit, and so on. B must not be
 * in-house (A, not checked in yet either, swaps before check-in). Rates stay as booked.
 */
export type SwapSide = {
  id: string;
  code: string;
  status: string;
  propertyId: string;
  checkInDate: Date;
  checkOutDate: Date;
  allocations: { roomId: string; startDate: Date; endDate: Date }[];
  chargesPosted: boolean;
};

const NOT_ARRIVED = new Set(["CONFIRMED", "ENQUIRY"]);

/** "1 room" / "2 rooms". */
export const unitLabel = (n: number) => `${n} room${n === 1 ? "" : "s"}`;

/** A user-safe reason the two bookings can't swap, or null when they can. */
export function swapProblem(a: SwapSide, b: SwapSide): string | null {
  if (a.id === b.id) return "Pick a different booking to swap with.";
  if (b.status === "IN_HOUSE") return `${b.code}'s guest is already staying (in-house) — their room can't be swapped. Choose a booking that hasn't checked in.`;
  if (a.status === "IN_HOUSE") return `${a.code} is already checked in — use Move room for an in-house guest.`;
  for (const s of [a, b]) {
    if (!NOT_ARRIVED.has(s.status)) return `${s.code} is ${s.status.toLowerCase().replace("_", " ")} — only bookings not yet checked in can swap rooms.`;
    if (s.allocations.length === 0) return `${s.code} has no room assigned — assign one instead of swapping.`;
    // A split stay (different rooms on different nights) has no single unit to hand over.
    if (s.allocations.some((x) => x.startDate.getTime() !== s.checkInDate.getTime() || x.endDate.getTime() !== s.checkOutDate.getTime())) {
      return `${s.code} is a split stay (different rooms on different nights) — change its rooms with Move room instead.`;
    }
    if (s.chargesPosted) return `${s.code} already has charges on its bill — it can't move rooms before check-in.`;
  }
  if (a.allocations.length !== b.allocations.length) {
    return `Swap like for like: ${a.code} has ${unitLabel(a.allocations.length)}, ${b.code} has ${unitLabel(b.allocations.length)}.`;
  }
  const aRooms = new Set(a.allocations.map((x) => x.roomId));
  if (b.allocations.some((x) => aRooms.has(x.roomId))) return "The two bookings share a room — nothing to swap.";
  return null;
}
