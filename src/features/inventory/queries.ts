/**
 * Inventory reads — 20 (FR-1). Property-scoped via `db.scoped(user)`.
 * `InventoryMovement` carries no `propertyId` (it hangs off the item), so its
 * history is scoped through the item relation.
 */
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { SessionClaims } from "@/lib/auth/claims";
import { belowReorder } from "./domain/reorder";
import { round6 } from "./domain/on-hand";
import { laundryLineStatus, laundryBatchTotals, type LaundryLineStatus } from "./domain/laundry";

/**
 * Store summary — total items, how many are low / out of stock, open laundry
 * batches awaiting reconciliation, and the item count per InventoryDomain (the 6
 * domains). Low/out-of-stock compare on-hand vs reorder per item (no groupBy can
 * compare two columns), so items are read once and reduced in memory — cheap at
 * property scale. Property-scoped; `inventory:manage`.
 */
export type InventoryOverview = {
  totalItems: number;
  lowStock: number;
  outOfStock: number;
  openLaundryBatches: number;
  byDomain: { domain: string; count: number }[];
};

export async function inventoryOverview(user: SessionClaims, propertyId: string): Promise<InventoryOverview> {
  authorize(user, "inventory:manage", propertyId);
  const scoped = db.scoped(user);
  const [rows, openLaundryBatches] = await Promise.all([
    scoped.inventoryItem.findMany({ where: { propertyId }, select: { onHand: true, reorderLevel: true, domain: true } }),
    scoped.laundryBatch.count({ where: { propertyId, status: "OPEN" } }),
  ]);

  let lowStock = 0;
  let outOfStock = 0;
  const domainCounts = new Map<string, number>();
  for (const r of rows) {
    if (belowReorder(r.onHand, r.reorderLevel)) lowStock++;
    if (round6(r.onHand) <= 0) outOfStock++;
    domainCounts.set(r.domain, (domainCounts.get(r.domain) ?? 0) + 1);
  }
  const byDomain = [...domainCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);

  return { totalItems: rows.length, lowStock, outOfStock, openLaundryBatches, byDomain };
}

export type StockLevel = {
  id: string;
  name: string;
  unit: string;
  domain: string;
  category: string;
  onHand: number;
  reorderLevel: number;
  lastCostPaise: number | null;
  low: boolean;
};

/** On-hand stock levels for a property, with low-stock flag (design § Query). */
export async function stockLevels(
  user: SessionClaims,
  input: { propertyId: string; domain?: string },
): Promise<StockLevel[]> {
  const rows = await db.scoped(user).inventoryItem.findMany({
    where: { propertyId: input.propertyId, ...(input.domain ? { domain: input.domain as never } : {}) },
    select: {
      id: true, name: true, unit: true, domain: true, category: true,
      onHand: true, reorderLevel: true, lastCostPaise: true,
    },
    orderBy: [{ domain: "asc" }, { name: "asc" }],
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

// --- Laundry reconciliation (FR-8/9) ---

export type LaundryBatchLine = {
  id: string;
  itemName: string;
  sentQty: number;
  returnedQty: number;
  toleranceQty: number;
  balance: number;
  status: LaundryLineStatus;
};

export type LaundryBatchView = {
  id: string;
  sentOn: Date;
  vendor: string | null;
  note: string | null;
  status: string; // OPEN | RECONCILED
  reconciledAt: Date | null;
  items: LaundryBatchLine[];
  totals: { sent: number; returned: number; balance: number; anyShort: boolean };
};

export async function listLaundryBatches(
  user: SessionClaims,
  input: { propertyId: string; status?: "OPEN" | "RECONCILED" },
): Promise<LaundryBatchView[]> {
  const rows = await db.scoped(user).laundryBatch.findMany({
    where: { propertyId: input.propertyId, ...(input.status ? { status: input.status } : {}) },
    select: {
      id: true, sentOn: true, vendor: true, note: true, status: true, reconciledAt: true,
      items: { select: { id: true, itemName: true, sentQty: true, returnedQty: true, toleranceQty: true }, orderBy: { itemName: "asc" } },
    },
    orderBy: { sentOn: "desc" },
    take: 100,
  });

  return rows.map((b) => {
    const recorded = b.status === "RECONCILED";
    return {
      id: b.id,
      sentOn: b.sentOn,
      vendor: b.vendor,
      note: b.note,
      status: b.status,
      reconciledAt: b.reconciledAt,
      items: b.items.map((it) => ({
        ...it,
        ...laundryLineStatus(it.sentQty, it.returnedQty, it.toleranceQty, recorded),
      })),
      totals: laundryBatchTotals(b.items, recorded),
    };
  });
}
