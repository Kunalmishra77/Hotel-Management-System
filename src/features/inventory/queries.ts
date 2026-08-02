/**
 * Inventory reads — 20 (FR-1). Property-scoped via `db.scoped(user)`.
 * `InventoryMovement` carries no `propertyId` (it hangs off the item), so its
 * history is scoped through the item relation.
 */
import { db } from "@/lib/db";
import type { SessionClaims } from "@/lib/auth/claims";
import { belowReorder } from "./domain/reorder";
import { round6 } from "./domain/on-hand";

export type StockLevel = {
  id: string;
  name: string;
  unit: string;
  category: string;
  onHand: number;
  reorderLevel: number;
  lastCostPaise: number | null;
  low: boolean;
};

/** On-hand stock levels for a property, with low-stock flag (design § Query). */
export async function stockLevels(
  user: SessionClaims,
  input: { propertyId: string },
): Promise<StockLevel[]> {
  const rows = await db.scoped(user).inventoryItem.findMany({
    where: { propertyId: input.propertyId },
    select: {
      id: true, name: true, unit: true, category: true,
      onHand: true, reorderLevel: true, lastCostPaise: true,
    },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    ...r,
    onHand: round6(r.onHand),
    low: belowReorder(r.onHand, r.reorderLevel),
  }));
}

export type MovementListItem = {
  id: string;
  delta: number;
  reason: string;
  refType: string | null;
  refId: string | null;
  createdAt: Date;
};

/** Recent movements for one item (movement history panel). Item-scoped. */
export async function listMovements(
  user: SessionClaims,
  input: { itemId: string; propertyId: string; limit?: number },
): Promise<MovementListItem[]> {
  const rows = await db.scoped(user).inventoryMovement.findMany({
    // InventoryMovement is not a property-scoped model; scope through the item.
    where: { itemId: input.itemId, item: { propertyId: input.propertyId } },
    select: { id: true, delta: true, reason: true, refType: true, refId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 50,
  });
  return rows.map((r) => ({ ...r, delta: round6(r.delta) }));
}
