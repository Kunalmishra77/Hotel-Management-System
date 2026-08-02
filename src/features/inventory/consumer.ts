/**
 * Inventory event consumer — 20 T-8 (FR-3/4, AC-4/5/8/10).
 *
 * Reacts to `PosOrderSettled` (emitted by 19) — by TYPE STRING only; 20 never
 * imports 19. It maps each settled menu line to stock via `RecipeComponent`,
 * aggregates per inventory item, and posts one negative `InventoryMovement` per
 * item, stamped `refType=PosOrder, refId=<orderId>, itemId`. That triple is the
 * DB idempotency key (`@@unique([refType, refId, itemId])`): a re-delivered
 * event deducts EXACTLY ONCE (AC-8).
 *
 * ── Payload contract (defensive) ──────────────────────────────────────────
 * Expected: { posOrderId, propertyId, items: [{ menuItemId, quantity }] }.
 * Fallbacks: posOrderId ← envelope.aggregateId (PosOrderSettled is keyed by the
 * order id); items[].qty accepted as an alias for quantity. If 19's final shape
 * differs, the parent reconciles at merge — the mapping is isolated in
 * `parsePayload` so only that function changes.
 */
import { db } from "@/lib/db";
import { runWithSystemContext } from "@/lib/context";
import { logger } from "@/lib/logger";
import { registerConsumer, type EventConsumer, type EventEnvelope } from "@/lib/events/dispatch";
import { consumptionFor, type OrderLine } from "./domain/consumption";
import { applyMovementTx, isUniqueViolation } from "./internal";
import { POS_ORDER_REF_TYPE } from "./events";

/** Pull the order id + line items out of a PosOrderSettled payload defensively. */
function parsePayload(envelope: EventEnvelope): { posOrderId: string; items: OrderLine[] } {
  const p = (envelope.payload ?? {}) as Record<string, unknown>;
  const posOrderId = typeof p.posOrderId === "string" ? p.posOrderId : envelope.aggregateId;
  const rawItems = Array.isArray(p.items) ? p.items : [];
  const items: OrderLine[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const menuItemId = typeof r.menuItemId === "string" ? r.menuItemId : null;
    const qty = typeof r.quantity === "number" ? r.quantity : typeof r.qty === "number" ? r.qty : null;
    if (menuItemId && qty != null) items.push({ menuItemId, quantity: qty });
  }
  return { posOrderId, items };
}

async function handle(envelope: EventEnvelope): Promise<void> {
  const { posOrderId, items } = parsePayload(envelope);
  if (items.length === 0) return;

  const prisma = db.unscoped();
  const menuItemIds = [...new Set(items.map((i) => i.menuItemId))];
  const recipes = await prisma.recipeComponent.findMany({
    where: { menuItemId: { in: menuItemIds } },
    select: { menuItemId: true, itemId: true, qtyPerUnit: true },
  });

  const { deductions, skippedMenuItemIds } = consumptionFor({ items }, recipes);
  if (skippedMenuItemIds.length > 0) {
    // AC-10: a menu item with no recipe is flagged, not fatal — others deduct.
    logger.info("inventory.no_recipe_skipped", { posOrderId, skippedMenuItemIds });
  }

  for (const d of deductions) {
    try {
      await runWithSystemContext(envelope.orgId, () =>
        prisma.$transaction((tx) =>
          applyMovementTx(tx, {
            itemId: d.itemId,
            delta: -d.qty,
            reason: "CONSUMPTION",
            refType: POS_ORDER_REF_TYPE,
            refId: posOrderId,
            // POS sales already happened; the deduction must post even below zero
            // (it then crosses reorder → LowStockDetected). See internal.ts.
            allowNegative: true,
            auditAction: "inventory:consume",
          }),
        ),
      );
    } catch (e) {
      // Concurrent re-delivery lost the race on the unique key → already deducted.
      if (isUniqueViolation(e)) {
        logger.info("inventory.duplicate_deduction_skipped", { posOrderId, itemId: d.itemId });
        continue;
      }
      throw e; // real failure → dispatcher retries / dead-letters (never drops)
    }
  }
}

export const inventoryConsumer: EventConsumer = {
  name: "inventory",
  types: ["PosOrderSettled"],
  handle,
};

let registered = false;
/** Register with the dispatcher (idempotent — safe to call twice). */
export function registerInventoryConsumer(): void {
  if (registered) return;
  registerConsumer(inventoryConsumer);
  registered = true;
}
