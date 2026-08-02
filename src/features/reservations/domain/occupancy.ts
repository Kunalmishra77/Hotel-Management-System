/**
 * validateOccupancy() — 03 T-9 (FR-17, AC-4).
 *
 * A room category has `maxAdults`/`maxChildren`. Occupancy within those limits is
 * always fine. Exceeding them is rejected **unless** an extra-bed override is
 * applied — one extra bed accommodates one additional guest beyond the category's
 * combined base capacity. Anything beyond that is refused regardless (an extra
 * bed is one bed, not a blank cheque).
 *
 * AC-4: 3 adults into Deluxe (max 2 adults / 1 child) — rejected without an extra
 * bed; accepted with one (3 ≤ base capacity 3 + 1).
 */
export type OccupancyResult = { ok: true } | { ok: false; code: "OCCUPANCY_EXCEEDED" };

export function validateOccupancy(
  category: { maxAdults: number; maxChildren: number },
  adults: number,
  children: number,
  extraBed: boolean,
): OccupancyResult {
  const withinBase = adults <= category.maxAdults && children <= category.maxChildren;
  if (withinBase) return { ok: true };

  if (extraBed) {
    const baseCapacity = category.maxAdults + category.maxChildren;
    if (adults + children <= baseCapacity + 1) return { ok: true };
  }

  return { ok: false, code: "OCCUPANCY_EXCEEDED" };
}
