/**
 * Room-allocation segments of ONE booking — pure helpers (no I/O).
 *
 * A booking normally holds one allocation per room for its whole stay, but a
 * mid-stay room move leaves TWO kinds of rows: finished segments (the old room,
 * ending on the move date) and the current "tail" segment (the room the guest is
 * in through check-out). Extend, overstay, early check-out and check-out must act
 * on the tail only: stretching or freeing EVERY row re-opened the old room (it was
 * stretched to the new check-out, blocked for nights the guest wasn't there, or
 * set to housekeeping while someone else was in it).
 */

export type AllocationSegment = { id: string; roomId: string; startDate: Date; endDate: Date };

/** The segments that run to the end of the stay (the room(s) the guest leaves from). */
export function tailAllocations<T extends AllocationSegment>(allocs: T[], checkOutDate?: Date): T[] {
  if (allocs.length === 0) return [];
  if (checkOutDate) {
    const atCheckOut = allocs.filter((a) => a.endDate.getTime() === checkOutDate.getTime());
    if (atCheckOut.length > 0) return atCheckOut;
  }
  // Data that doesn't line up with the booking's check-out: take the latest-ending.
  const latest = Math.max(...allocs.map((a) => a.endDate.getTime()));
  return allocs.filter((a) => a.endDate.getTime() === latest);
}

/** Segments covering a given night (start ≤ day < end) — "who is in which room tonight". */
export function allocationsOn<T extends AllocationSegment>(allocs: T[], day: Date): T[] {
  return allocs.filter((a) => a.startDate.getTime() <= day.getTime() && a.endDate.getTime() > day.getTime());
}

/**
 * Plan for leaving early on `effectiveCheckOut`: segments that end later are cut
 * to it; a segment that would start on/after it never happened and is deleted.
 * Finished segments ending on/before it are untouched.
 */
export function earlyCheckoutPlan<T extends AllocationSegment>(allocs: T[], effectiveCheckOut: Date): { shorten: T[]; remove: T[] } {
  const t = effectiveCheckOut.getTime();
  const later = allocs.filter((a) => a.endDate.getTime() > t);
  return {
    shorten: later.filter((a) => a.startDate.getTime() < t),
    remove: later.filter((a) => a.startDate.getTime() >= t),
  };
}
