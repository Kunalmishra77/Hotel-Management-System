"use server";

/**
 * 20 addendum — laundry linen reconciliation (FR-8/9/10). A batch is sent OPEN
 * with per-line sent quantities; recording returns fills each line's returnedQty
 * and flips the batch to RECONCILED. Balance/short is derived (see domain/laundry).
 * Quantities are integer counts, never money. Gated on `inventory:manage`.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { emitEvent } from "@/lib/events";
import { writeAudit } from "@/lib/audit";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { inventoryDb, withInventoryContext } from "./internal";
import { createLaundryBatchSchema, recordLaundryReturnsSchema } from "./schema";

export type LaundryBatchResult = { id: string };

export async function createLaundryBatch(input: unknown): Promise<Result<LaundryBatchResult>> {
  return toResult(async () => {
    const data = createLaundryBatchSchema.parse(input);
    const user = await requireUser();
    authorize(user, "inventory:manage", data.propertyId);

    return withInventoryContext(user, () =>
      inventoryDb(user).$transaction(async (tx) => {
        const batch = await tx.laundryBatch.create({
          data: {
            propertyId: data.propertyId,
            sentOn: data.sentOn,
            vendor: data.vendor ?? null,
            note: data.note ?? null,
            status: "OPEN",
            createdById: user.userId,
            items: {
              create: data.items.map((it) => ({ itemName: it.itemName, sentQty: it.sentQty, toleranceQty: it.toleranceQty })),
            },
          },
          select: { id: true },
        });
        const totalSent = data.items.reduce((s, it) => s + it.sentQty, 0);
        await emitEvent(tx, {
          type: "LaundryBatchCreated",
          aggregateId: batch.id,
          propertyId: data.propertyId,
          payload: { lines: data.items.length, totalSent },
        });
        await writeAudit(tx, {
          action: "inventory:laundry-batch-create",
          entityType: "LaundryBatch",
          entityId: batch.id,
          propertyId: data.propertyId,
          after: { sentOn: data.sentOn.toISOString().slice(0, 10), lines: data.items.length, totalSent },
        });
        return { id: batch.id };
      }),
    );
  });
}

export type LaundryReconcileResult = { id: string; status: string };

export async function recordLaundryReturns(input: unknown): Promise<Result<LaundryReconcileResult>> {
  return toResult(async () => {
    const data = recordLaundryReturnsSchema.parse(input);
    const user = await requireUser();
    const client = inventoryDb(user);

    const batch = await client.laundryBatch.findFirst({
      where: { id: data.batchId },
      select: { id: true, propertyId: true, status: true, items: { select: { id: true } } },
    });
    if (!batch) throw new NotFoundError("Laundry batch not found.");
    authorize(user, "inventory:manage", batch.propertyId);

    // Every returned line must belong to this batch.
    const batchItemIds = new Set(batch.items.map((i) => i.id));
    for (const r of data.returns) {
      if (!batchItemIds.has(r.itemId)) throw new DomainError(ErrorCode.VALIDATION_FAILED, "A return line does not belong to this batch.");
    }

    const wasReconciled = batch.status === "RECONCILED";

    return withInventoryContext(user, () =>
      client.$transaction(async (tx) => {
        for (const r of data.returns) {
          await tx.laundryBatchItem.updateMany({ where: { id: r.itemId, batchId: batch.id }, data: { returnedQty: r.returnedQty } });
        }
        await tx.laundryBatch.updateMany({
          where: { id: batch.id },
          data: { status: "RECONCILED", ...(wasReconciled ? {} : { reconciledAt: new Date() }) },
        });
        // Emit the reconciled event only on the first reconciliation (not on a later correction).
        if (!wasReconciled) {
          await emitEvent(tx, { type: "LaundryBatchReconciled", aggregateId: batch.id, propertyId: batch.propertyId, payload: { lines: data.returns.length } });
        }
        await writeAudit(tx, {
          action: "inventory:laundry-returns",
          entityType: "LaundryBatch",
          entityId: batch.id,
          propertyId: batch.propertyId,
          after: { returns: data.returns.length, correction: wasReconciled },
        });
        return { id: batch.id, status: "RECONCILED" };
      }),
    );
  });
}
