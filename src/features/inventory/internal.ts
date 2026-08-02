/**
 * Shared internals for 20-inventory. NOT a "use server" module.
 *
 * `applyMovementTx` is the single write primitive both the manual actions and
 * the POS consumer call, so the canonical effects — negative-stock guard, cache
 * update, `StockMovementRecorded`, low-stock crossing → `LowStockDetected`,
 * audit — happen identically no matter who triggers the movement.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { newRequestId, runWithContext } from "@/lib/context";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import type { SessionClaims } from "@/lib/auth/claims";
import { round6 } from "./domain/on-hand";
import { crossedBelowReorder, belowReorder } from "./domain/reorder";

export function inventoryDb(user: SessionClaims) {
  return db.scoped(user);
}

export function withInventoryContext<T>(user: SessionClaims, fn: () => Promise<T>): Promise<T> {
  return runWithContext(
    {
      orgId: user.orgId,
      userId: user.userId,
      propertyScope: user.propertyScope,
      activePropertyId: user.activePropertyId,
      requestId: newRequestId(),
      ip: null,
      device: null,
    },
    fn,
  );
}

export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

/**
 * Negative-stock policy (FR-5) — config-explicit.
 *
 * The MANUAL action path enforces the guard (default off): a keyed-in
 * consumption that would take on-hand below zero is rejected as NEGATIVE_STOCK
 * rather than silently applied (AC-6). Set `INVENTORY_ALLOW_NEGATIVE_STOCK=true`
 * to permit it.
 *
 * The POS CONSUMER passes `allowNegative: true` deliberately: a settled sale
 * already happened in the real world, so the deduction must post even if it
 * drives on-hand below zero — that sub-zero level then crosses the reorder
 * threshold and fires `LowStockDetected` so staff restock. Refusing it would
 * only dead-letter the event, never un-sell the coffee.
 */
export const NEGATIVE_STOCK_ALLOWED = process.env.INVENTORY_ALLOW_NEGATIVE_STOCK === "true";

type Tx = Prisma.TransactionClient;

export type MovementReason = "PURCHASE" | "CONSUMPTION" | "ADJUST";

export type ApplyMovementArgs = {
  itemId: string;
  /** + purchase, − consumption. */
  delta: number;
  reason: MovementReason;
  refType?: string | null;
  refId?: string | null;
  allowNegative?: boolean;
  /** `module:action` for the audit row. */
  auditAction: string;
};

export type MovementOutcome = {
  itemId: string;
  /** false when a ref'd movement was already recorded (idempotent no-op). */
  applied: boolean;
  onHand: number;
  belowReorder: boolean;
  /** true when this movement crossed strictly below reorder (LowStock fired). */
  crossed: boolean;
};

/**
 * Post one inventory movement inside the caller's transaction and reconcile
 * everything atomically. Idempotent for ref'd movements via a pre-check on the
 * `@@unique([refType, refId, itemId])` key — a re-delivered PosOrderSettled or a
 * re-submitted expense purchase is a no-op (`applied: false`). The DB unique
 * constraint is the ultimate guard for the concurrent-race case; callers that
 * pass a ref should treat a P2002 from this function's transaction as "already
 * applied" (see the consumer).
 */
export async function applyMovementTx(tx: Tx, args: ApplyMovementArgs): Promise<MovementOutcome> {
  const { itemId, delta, reason, refType = null, refId = null, allowNegative = false, auditAction } = args;

  const item = await tx.inventoryItem.findFirst({
    where: { id: itemId },
    select: { id: true, propertyId: true, name: true, onHand: true, reorderLevel: true },
  });
  if (!item) throw new NotFoundError("Inventory item not found.");

  // Idempotency: a ref'd movement that already exists is a no-op. (NULL refs are
  // distinct in Postgres, so manual adjust/purchase-without-ref always post.)
  if (refType && refId) {
    const existing = await tx.inventoryMovement.findFirst({
      where: { refType, refId, itemId },
      select: { id: true },
    });
    if (existing) {
      return {
        itemId,
        applied: false,
        onHand: round6(item.onHand),
        belowReorder: belowReorder(item.onHand, item.reorderLevel),
        crossed: false,
      };
    }
  }

  const before = round6(item.onHand);
  const after = round6(before + delta);

  if (delta < 0 && after < 0 && !allowNegative) {
    throw new DomainError(ErrorCode.NEGATIVE_STOCK, "Movement would take stock below zero.", {
      details: { itemId, before, delta },
    });
  }

  await tx.inventoryMovement.create({
    data: { itemId, delta, reason, refType, refId },
    select: { id: true },
  });
  await tx.inventoryItem.updateMany({ where: { id: itemId }, data: { onHand: after } });

  await emitEvent(tx, {
    type: "StockMovementRecorded",
    aggregateId: itemId,
    propertyId: item.propertyId,
    payload: { delta, reason, refType, refId, onHand: after },
  });

  const crossed = crossedBelowReorder(before, after, item.reorderLevel);
  if (crossed) {
    await emitEvent(tx, {
      type: "LowStockDetected",
      aggregateId: itemId,
      propertyId: item.propertyId,
      payload: { name: item.name, onHand: after, reorderLevel: item.reorderLevel },
    });
  }

  await writeAudit(tx, {
    action: auditAction,
    entityType: "InventoryItem",
    entityId: itemId,
    propertyId: item.propertyId,
    before: { onHand: before },
    after: { onHand: after, delta, reason },
  });

  return { itemId, applied: true, onHand: after, belowReorder: belowReorder(after, item.reorderLevel), crossed };
}
