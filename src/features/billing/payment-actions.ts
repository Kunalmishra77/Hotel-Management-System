"use server";

/**
 * Payments + refunds — 06 T-12/T-13 (FR-8/9/10, AC-8/9/10/11). Split tenders post
 * in ONE transaction sharing a `settlementBatchId`, emitting ONE `PaymentReceived`
 * carrying the batch + tenders (so 22/12 reconcile without re-reading rows).
 * Refunds are stored positive with `isRefund` and are capped at net-paid.
 */
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { splitSumsTo } from "./domain/money";
import { refundWithinNetPaid } from "./domain/balance";
import { billingDb, loadFolioContext, withBillingContext } from "./internal";
import { recordPaymentSchema, refundSchema } from "./schema";

export type PaymentResult = { batchId: string; totalPaise: number };

/** Record 1..n tenders atomically under one settlement batch (FR-8/9, AC-8/9/10). */
export async function recordPayment(input: unknown): Promise<Result<PaymentResult>> {
  return toResult(async () => {
    const data = recordPaymentSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "payment:record", ctx.propertyId);

    const total = data.tenders.reduce((sum, t) => sum + t.amountPaise, 0);
    if (data.expectedTotalPaise != null && !splitSumsTo(data.tenders.map((t) => t.amountPaise), data.expectedTotalPaise)) {
      throw new DomainError(ErrorCode.SPLIT_MISMATCH);
    }

    const batchId = randomUUID();
    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        for (const t of data.tenders) {
          await tx.payment.create({
            data: {
              propertyId: ctx.propertyId,
              folioId: data.folioId,
              mode: t.mode,
              amountPaise: BigInt(t.amountPaise),
              reference: t.reference ?? null,
              settlementBatchId: batchId,
              isRefund: false,
              receivedById: user.userId,
            },
          });
        }
        // ONE event for the whole batch, carrying the tenders (FR-8).
        await emitEvent(tx, {
          type: "PaymentReceived",
          aggregateId: data.folioId,
          propertyId: ctx.propertyId,
          payload: { folioId: data.folioId, settlementBatchId: batchId, tenders: data.tenders.map((t) => ({ mode: t.mode, amountPaise: t.amountPaise })) },
        });
        await writeAudit(tx, { action: "payment:record", entityType: "Folio", entityId: data.folioId, propertyId: ctx.propertyId, after: { settlementBatchId: batchId, totalPaise: total } });
        return { batchId, totalPaise: total };
      }),
    );
  });
}

export type RefundResult = { paymentId: string };

/** Refund within net-paid (FR-10, AC-11): folio:refund; Payment(isRefund, positive). */
export async function refund(input: unknown): Promise<Result<RefundResult>> {
  return toResult(async () => {
    const data = refundSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const ctx = await loadFolioContext(client, data.folioId);
    if (!ctx) throw new NotFoundError("Folio not found.");
    authorize(user, "folio:refund", ctx.propertyId, { reason: data.reason });

    const payments = await client.payment.findMany({ where: { folioId: data.folioId }, select: { amountPaise: true, isRefund: true } });
    if (!refundWithinNetPaid(data.amountPaise, payments)) {
      throw new DomainError(ErrorCode.REFUND_EXCEEDS_PAID);
    }

    return withBillingContext(user, () =>
      client.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            propertyId: ctx.propertyId,
            folioId: data.folioId,
            mode: data.mode,
            amountPaise: BigInt(data.amountPaise), // positive; isRefund carries direction
            isRefund: true,
            receivedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "PaymentRefunded", aggregateId: data.folioId, propertyId: ctx.propertyId, payload: { paymentId: payment.id, amountPaise: data.amountPaise } });
        await writeAudit(tx, { action: "folio:refund", entityType: "Payment", entityId: payment.id, propertyId: ctx.propertyId, reason: data.reason, after: { amountPaise: data.amountPaise } });
        return { paymentId: payment.id };
      }),
    );
  });
}
