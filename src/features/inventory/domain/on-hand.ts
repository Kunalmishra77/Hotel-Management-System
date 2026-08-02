/**
 * On-hand quantity — 20 domain (FR-1, AC-2).
 *
 * The cached `InventoryItem.onHand` column exists for fast lists, but the TRUTH
 * is the running sum of `InventoryMovement.delta` (+purchase, −consumption,
 * ±adjust). `onHand()` derives that truth from the movements; `recordMovement`
 * keeps the cache in step atomically. Pure — no I/O, unit-testable.
 */

/**
 * Round to 6 decimal places to keep float accumulation clean.
 *
 * Quantities are `Float` in the schema (kg, litres, cups…), so 0.02 × 50 can
 * land at 1.0000000000000002 in IEEE-754. Rounding at each step keeps
 * `belowReorder`'s strict `<` boundary from being tripped by drift, and keeps
 * a displayed on-hand from reading 4.499999999999999.
 */
export function round6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

/** Sum of movement deltas = the authoritative on-hand quantity (FR-1). */
export function onHand(movements: readonly { delta: number }[]): number {
  return round6(movements.reduce((sum, m) => sum + m.delta, 0));
}
