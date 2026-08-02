"use server";

/**
 * Walk-in POS direct sale — 06 T-22b (FR-25, AC-26). Composes the existing money
 * actions in sequence (design.md § Walk-in POS): ensure the DIRECT_SALE house
 * folio → post the line(s) → take payment → issue a gap-free GST invoice, and
 * return `{invoiceId, paymentId}`. Called by 19-POS.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { DomainError, ErrorCode } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { ensureDirectSaleFolio } from "./folio-actions";
import { postFolioCharge } from "./charge-actions";
import { recordPayment } from "./payment-actions";
import { generateInvoice } from "./invoice-actions";

const posSaleSchema = z.object({
  propertyId: z.string().min(1),
  customerName: z.string().min(1).max(200),
  customerGstin: z.string().max(20).optional(),
  items: z.array(z.object({
    type: z.enum(["FOOD", "KITCHEN", "LAUNDRY", "POS", "MISC"]),
    description: z.string().min(1).max(200),
    unitPaise: z.number().int().positive(),
    quantity: z.number().int().positive().default(1),
  })).min(1),
  tender: z.object({ mode: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI"]), amountPaise: z.number().int().positive() }),
});

/** Unwrap a nested action Result, re-throwing its typed error so toResult maps it. */
function unwrap<T>(r: Result<T>): T {
  if (!r.ok) throw new DomainError(r.error.code as ErrorCode, r.error.message);
  return r.data;
}

export async function settlePosSaleDirect(input: unknown): Promise<Result<{ invoiceId: string; paymentId: string; folioId: string }>> {
  return toResult(async () => {
    const data = posSaleSchema.parse(input);
    const user = await requireUser();
    authorize(user, "pos:order-settle", data.propertyId);

    const { folioId } = unwrap(await ensureDirectSaleFolio({ propertyId: data.propertyId }));

    for (const item of data.items) {
      unwrap(await postFolioCharge({ folioId, type: item.type, description: item.description, unitPaise: item.unitPaise, quantity: item.quantity }));
    }

    const pay = unwrap(await recordPayment({ folioId, tenders: [data.tender] }));
    // A single-tender sale → resolve the payment id from the batch.
    const payment = await db.scoped(user).payment.findFirst({ where: { folioId, settlementBatchId: pay.batchId }, select: { id: true } });

    const invoice = unwrap(await generateInvoice({ folioId, customerName: data.customerName, customerGstin: data.customerGstin }));

    return { invoiceId: invoice.invoiceId, paymentId: payment?.id ?? "", folioId };
  });
}
