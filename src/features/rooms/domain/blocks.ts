/**
 * Date-ranged room blocks — 02 T-9 (FR-7, AC-8/AC-9). Pure domain.
 *
 * A `RoomBlock` takes a room out of availability for a DATE RANGE, independently
 * of its live `status`. The two are complementary and must not be conflated
 * (design.md § Schema notes): status drives the board colour; the block drives
 * whether 03 may sell the room on a given night.
 *
 * ── Half-open intervals ──────────────────────────────────────────────────────
 * Every range here is [startDate, endDate) — the end day is NOT included. This
 * matches the `daterange(start, end, '[)')` exclusion constraint 03 uses for
 * no-overbooking (database-setup.md), and it is what makes a changeover work: a
 * stay ending on the 14th and a block starting on the 14th do not collide,
 * because the guest leaves that morning. Treating the range as closed would
 * refuse a legitimate same-day turnover on every single changeover.
 */

export type DateRange = {
  /** Inclusive. */
  startDate: Date;
  /** EXCLUSIVE — the room is free again on this date. */
  endDate: Date;
};

/** Do two half-open ranges share at least one night? */
export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  const aStart = a.startDate.getTime();
  const aEnd = a.endDate.getTime();
  const bStart = b.startDate.getTime();
  const bEnd = b.endDate.getTime();

  // An empty or inverted range covers no nights, so it can collide with nothing.
  if (aEnd <= aStart || bEnd <= bStart) return false;

  return aStart < bEnd && bStart < aEnd;
}

/** Every block colliding with `range` — so a refusal can name the culprit. */
export function blocksOverlapping(
  blocks: readonly DateRange[],
  range: DateRange,
): DateRange[] {
  return blocks.filter((block) => rangesOverlap(block, range));
}

/**
 * Is the room out of order for any part of `range`? (AC-8)
 *
 * True regardless of the room's status — a VACANT room with an overlapping
 * block is still unsellable for those nights.
 */
export function isRoomBlockedDuring(
  blocks: readonly DateRange[],
  range: DateRange,
): boolean {
  return blocks.some((block) => rangesOverlap(block, range));
}
