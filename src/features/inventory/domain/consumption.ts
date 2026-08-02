/**
 * POS → stock consumption — 20 domain (FR-3, AC-4/10).
 *
 * Maps a settled POS order (menu item × quantity) to inventory deductions via
 * `RecipeComponent`. Pure: it does not touch the DB, so the consumer can unit
 * this independently of Prisma.
 *
 * Two invariants it encodes:
 *  - **Aggregate per inventory item.** Several menu lines can draw on the same
 *    stock item; they must collapse to ONE deduction so the movement's
 *    `@@unique([refType, refId, itemId])` idempotency key holds and the total is
 *    correct (AC-4).
 *  - **Missing recipe is skipped, not fatal** (AC-10): a menu item with no
 *    components is reported in `skippedMenuItemIds` and the other lines still
 *    deduct — no crash.
 */
import { round6 } from "./on-hand";

export type OrderLine = { menuItemId: string; quantity: number };
export type Recipe = { menuItemId: string; itemId: string; qtyPerUnit: number };
/** A net deduction for one inventory item (positive magnitude). */
export type Deduction = { itemId: string; qty: number };
export type ConsumptionResult = {
  deductions: Deduction[];
  /** Menu items in the order that had no recipe — flagged, not deducted (AC-10). */
  skippedMenuItemIds: string[];
};

export function consumptionFor(
  order: { items: readonly OrderLine[] },
  recipes: readonly Recipe[],
): ConsumptionResult {
  const byMenu = new Map<string, Recipe[]>();
  for (const r of recipes) {
    const arr = byMenu.get(r.menuItemId);
    if (arr) arr.push(r);
    else byMenu.set(r.menuItemId, [r]);
  }

  const totals = new Map<string, number>();
  const skipped = new Set<string>();

  for (const line of order.items) {
    if (line.quantity <= 0) continue;
    const comps = byMenu.get(line.menuItemId);
    if (!comps || comps.length === 0) {
      skipped.add(line.menuItemId);
      continue;
    }
    for (const c of comps) {
      const add = round6(c.qtyPerUnit * line.quantity);
      totals.set(c.itemId, round6((totals.get(c.itemId) ?? 0) + add));
    }
  }

  const deductions = [...totals.entries()]
    .map(([itemId, qty]) => ({ itemId, qty }))
    .filter((d) => d.qty > 0);

  return { deductions, skippedMenuItemIds: [...skipped] };
}
