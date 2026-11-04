/**
 * Room swap between two bookings — pure checks (no I/O).
 *
 * Guest A wants the room(s) Guest B is booked into; B must NOT be in-house. Like
 * for like only: single ↔ single, 2 BHK ↔ 2 BHK. Each guest keeps their dates and
 * agreed rate.
 *  - A not checked in yet: A takes B's unit for A's dates, B takes A's unit for
 *    B's dates — across properties too.
 *  - A already in-house: A moves into B's unit FROM TODAY (the nights already
 *    stayed stay in the old room), B gets A's unit for B's dates. Same property
 *    only — an in-house guest's bill already carries this property's charges, so
 *    a move to another property is a Transfer.
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

/** The unit a booking holds now: for an in-house guest the room(s) they're in through check-out. */
export function currentUnit<T extends { startDate: Date; endDate: Date }>(s: { checkOutDate: Date; allocations: T[] }): T[] {
  return s.allocations.filter((x) => x.endDate.getTime() === s.checkOutDate.getTime());
}

/** A user-safe reason the two bookings can't swap, or null when they can. `today` = property-local day. */
export function swapProblem(a: SwapSide, b: SwapSide, today: Date): string | null {
  if (a.id === b.id) return "Pick a different booking to swap with.";
  if (b.status === "IN_HOUSE") return `${b.code}'s guest is already staying (in-house) — their room can't be swapped. Choose a booking that hasn't checked in, or a free room (Move to another room).`;
  if (!NOT_ARRIVED.has(b.status)) return `${b.code} is ${b.status.toLowerCase().replace("_", " ")} — only a booking that hasn't checked in can give up its room.`;
  const aInHouse = a.status === "IN_HOUSE";
  if (!aInHouse && !NOT_ARRIVED.has(a.status)) return `${a.code} is ${a.status.toLowerCase().replace("_", " ")} — it can't swap rooms.`;
  if (aInHouse) {
    if (a.propertyId !== b.propertyId) return `${a.code} is already checked in — an in-house guest swaps within the same property. To move them to another property, use Transfer to another property.`;
    if (a.checkOutDate.getTime() <= today.getTime()) return `${a.code} has no nights left — extend the stay first.`;
  }

  // The unit each side gives up: in-house → the current room(s); otherwise every room
  // for the whole stay (a split stay has no single unit to hand over).
  const aUnit = aInHouse ? currentUnit(a) : a.allocations;
  for (const s of aInHouse ? [b] : [a, b]) {
    if (s.allocations.some((x) => x.startDate.getTime() !== s.checkInDate.getTime() || x.endDate.getTime() !== s.checkOutDate.getTime())) {
      return `${s.code} is a split stay (different rooms on different nights) — change its rooms with Move room instead.`;
    }
  }
  for (const s of [a, b]) if (s.allocations.length === 0) return `${s.code} has no room assigned — assign one instead of swapping.`;
  if (aUnit.length === 0) return `${a.code} has no current room — assign one instead of swapping.`;
  if (!aInHouse && a.chargesPosted) return `${a.code} already has charges on its bill — it can't move rooms before check-in.`;
  if (b.chargesPosted) return `${b.code} already has charges on its bill — it can't give up its room before check-in.`;
  if (aUnit.length !== b.allocations.length) {
    return `Swap like for like: ${a.code} has ${unitLabel(aUnit.length)}, ${b.code} has ${unitLabel(b.allocations.length)}.`;
  }
  const aRooms = new Set(aUnit.map((x) => x.roomId));
  if (b.allocations.some((x) => aRooms.has(x.roomId))) return "The two bookings share a room — nothing to swap.";
  return null;
}
