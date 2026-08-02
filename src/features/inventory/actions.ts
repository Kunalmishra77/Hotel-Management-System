"use server";

/**
 * Inventory actions — 20 T-6/T-7 (FR-1/2/5/6, AC-1/2/3/6/7/9/11). Canonical
 * write path: zod.parse → requireUser → authorize("inventory:manage") →
 * transaction → emit event + audit → typed Result. Stock deductions from POS
 * arrive via the consumer, not an action (decoupled — the app never imports 19).
 */
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import {
  inventoryDb,
  withInventoryContext,
  applyMovementTx,
  isUniqueViolation,
  NEGATIVE_STOCK_ALLOWED,
  type MovementOutcome,
} from "./internal";
import { round6 } from "./domain/on-hand";
import { createItemSchema, updateItemSchema, recordMovementSchema, adjustStockSchema } from "./schema";

export type ItemResult = { id: string; name: string };

/** Create a store item (FR-1, AC-1/3). Name is unique per property. */
export async function createItem(input: unknown): Promise<Result<ItemResult>> {
  return toResult(async () => {
    const data = createItemSchema.parse(input);
    const user = await requireUser();
    authorize(user, "inventory:manage", data.propertyId);

    return withInventoryContext(user, async () => {
      const client = inventoryDb(user);
      // Friendly pre-check; the unique constraint is the real guard (race).
      const clash = await client.inventoryItem.findFirst({
        where: { propertyId: data.propertyId, name: data.name },
        select: { id: true },
      });
      if (clash) throw new ConflictError(`An item named "${data.name}" already exists at this property.`);

      try {
        return await client.$transaction(async (tx) => {
          const item = await tx.inventoryItem.create({
            data: {
              propertyId: data.propertyId,
              name: data.name,
              unit: data.unit,
              category: data.category,
              reorderLevel: data.reorderLevel,
              lastCostPaise: data.lastCostPaise ?? null,
              onHand: 0,
            },
            select: { id: true, name: true },
          });
          await emitEvent(tx, {
            type: "StockMovementRecorded",
            aggregateId: item.id,
            propertyId: data.propertyId,
            payload: { delta: 0, reason: "CREATE", onHand: 0 },
          });
          await writeAudit(tx, {
            action: "inventory:create-item",
            entityType: "InventoryItem",
            entityId: item.id,
            propertyId: data.propertyId,
            after: { name: data.name, unit: data.unit, reorderLevel: data.reorderLevel },
          });
          return item;
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new ConflictError(`An item named "${data.name}" already exists at this property.`);
        throw e;
      }
    });
  });
}

/** Update an item's catalog fields / reorder level (FR-1). */
export async function updateItem(input: unknown): Promise<Result<ItemResult>> {
  return toResult(async () => {
    const data = updateItemSchema.parse(input);
    const user = await requireUser();
    const client = inventoryDb(user);
    const item = await client.inventoryItem.findFirst({
      where: { id: data.itemId },
      select: { id: true, propertyId: true, name: true, reorderLevel: true },
    });
    if (!item) throw new NotFoundError("Inventory item not found.");
    authorize(user, "inventory:manage", item.propertyId);

    return withInventoryContext(user, () =>
      client.$transaction(async (tx) => {
        // updateMany, not update: the scoped client injects a propertyId filter,
        // which Prisma's unique-where `update` rejects (see 03 precedent).
        await tx.inventoryItem.updateMany({
          where: { id: data.itemId },
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.unit !== undefined ? { unit: data.unit } : {}),
            ...(data.category !== undefined ? { category: data.category } : {}),
            ...(data.reorderLevel !== undefined ? { reorderLevel: data.reorderLevel } : {}),
            ...(data.lastCostPaise !== undefined ? { lastCostPaise: data.lastCostPaise } : {}),
          },
        });
        const updated = { id: data.itemId, name: data.name ?? item.name };
        await writeAudit(tx, {
          action: "inventory:update-item",
          entityType: "InventoryItem",
          entityId: data.itemId,
          propertyId: item.propertyId,
          before: { name: item.name, reorderLevel: item.reorderLevel },
          after: { name: updated.name, reorderLevel: data.reorderLevel ?? item.reorderLevel },
        });
        return updated;
      }),
    );
  });
}

export type MovementResult = { itemId: string; onHand: number; belowReorder: boolean; applied: boolean };

/** Record a purchase/consumption/adjust movement (FR-2/5, AC-2/6/11). */
export async function recordMovement(input: unknown): Promise<Result<MovementResult>> {
  return toResult(async () => {
    const data = recordMovementSchema.parse(input);
    const user = await requireUser();
    const client = inventoryDb(user);
    const item = await client.inventoryItem.findFirst({
      where: { id: data.itemId },
      select: { propertyId: true },
    });
    if (!item) throw new NotFoundError("Inventory item not found.");
    authorize(user, "inventory:manage", item.propertyId);

    return withInventoryContext(user, async () => {
      const outcome = await client.$transaction((tx) =>
        applyMovementTx(tx as unknown as Prisma.TransactionClient, {
          itemId: data.itemId,
          delta: data.delta,
          reason: data.reason,
          refType: data.refType ?? null,
          refId: data.refId ?? null,
          allowNegative: NEGATIVE_STOCK_ALLOWED,
          auditAction: "inventory:record-movement",
        }),
      );
      return toMovementResult(outcome);
    });
  });
}

/** Stock-take: reconcile on-hand to a physically counted quantity (AC-9). */
export async function adjustStock(input: unknown): Promise<Result<MovementResult>> {
  return toResult(async () => {
    const data = adjustStockSchema.parse(input);
    const user = await requireUser();
    const client = inventoryDb(user);
    const item = await client.inventoryItem.findFirst({
      where: { id: data.itemId },
      select: { propertyId: true, onHand: true },
    });
    if (!item) throw new NotFoundError("Inventory item not found.");
    authorize(user, "inventory:manage", item.propertyId);

    const delta = round6(data.countedQuantity - item.onHand);

    return withInventoryContext(user, async () => {
      if (delta === 0) {
        return { itemId: data.itemId, onHand: round6(item.onHand), belowReorder: false, applied: false };
      }
      const outcome = await client.$transaction((tx) =>
        applyMovementTx(tx as unknown as Prisma.TransactionClient, {
          itemId: data.itemId,
          delta,
          reason: "ADJUST",
          allowNegative: true, // a counted quantity is authoritative and never < 0 (schema-guarded)
          auditAction: "inventory:adjust",
        }),
      );
      return toMovementResult(outcome);
    });
  });
}

function toMovementResult(o: MovementOutcome): MovementResult {
  return { itemId: o.itemId, onHand: o.onHand, belowReorder: o.belowReorder, applied: o.applied };
}
