/**
 * overlaps() — 03 T-8 (FR-2, AC-8).
 *
 * Half-open `[start, end)` overlap — the in-app pre-check that mirrors the
 * database exclusion constraint's `daterange(start, end, '[)')`. Inclusive start,
 * EXCLUSIVE end: a stay ending on the 15th and one starting on the 15th do NOT
 * overlap, so the checkout day is bookable (AC-8).
 *
 * Compared by calendar date (UTC day parts), matching how `@db.Date` values are
 * stored and how the constraint evaluates — never by wall-clock instant.
 */

/** Epoch day number from a Date's UTC calendar parts (date-only comparison). */
function utcEpochDay(date: Date): number {
  return Math.round(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000,
  );
}

export function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  const as = utcEpochDay(aStart);
  const ae = utcEpochDay(aEnd);
  const bs = utcEpochDay(bStart);
  const be = utcEpochDay(bEnd);
  // Standard half-open interval overlap: they share a night iff each starts
  // before the other ends. Adjacency (ae === bs) yields false.
  return as < be && bs < ae;
}
