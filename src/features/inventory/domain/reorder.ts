/**
 * Reorder threshold — 20 domain (FR-4, AC-5).
 *
 * `belowReorder` is strict `<`: an on-hand landing EXACTLY on the reorder level
 * is NOT below it and must not fire `LowStockDetected`. The crossing is what
 * matters — a movement emits the event only when on-hand goes from ≥ level to
 * < level (computed by the caller from before/after), so the alert fires once
 * per crossing rather than on every movement while low.
 */
export function belowReorder(onHand: number, reorderLevel: number): boolean {
  return onHand < reorderLevel;
}

/**
 * True when a movement crossed strictly below the reorder level: it was at or
 * above before and is below after. This is the LowStockDetected trigger (FR-4).
 */
export function crossedBelowReorder(
  before: number,
  after: number,
  reorderLevel: number,
): boolean {
  return !belowReorder(before, reorderLevel) && belowReorder(after, reorderLevel);
}
