"use server";

/**
 * "Correct bill" — specs/06 FR-RV-1 (client, 22 Nov 2026: one customer, one bill
 * number however many times it is corrected).
 *
 * Issues the next REVISION of the same invoice number from the folio's current
 * lines and the corrected bill-to, keeping the original issue date (the GST
 * amendment model), and marks the previous revision superseded. Nothing is
 * deleted or edited; registers and reports show only the current revision.
 * Elevated like a void (`invoice:void`, with a reason) and audited.
 */
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { attachInvoicePdf } from "./invoice-pdf-store";
import { billLines, insertInvoice } from "./invoice-issue";
import { billingDb, withBillingContext } from "./internal";
import { billToFields } from "./schema";

const reviseInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  customerName: z.string().trim().min(1).max(200),
  customerGstin: z.string().trim().max(20).optional().transform((v) => (v ? v.toUpperCase() : undefined)),
  ...billToFields,
  reason: z.string().trim().min(1).max(300),
});

export type ReviseResult = { invoiceId: string; number: string; revision: number; totalPaise: number };

const fail = (msg: string, code: ErrorCode = ErrorCode.VALIDATION_FAILED): never => {
  throw new DomainError(code, msg, { publicMessage: msg });
};

export async function reviseInvoice(input: unknown): Promise<Result<ReviseResult>> {
  return toResult(async () => {
    const data = reviseInvoiceSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const target = await client.invoice.findFirst({
      where: { id: data.invoiceId },
      select: { id: true, propertyId: true, folioId: true, number: true, financialYear: true, billPart: true, type: true, issuedAt: true, placeOfSupply: true, supersededById: true },
    });
    if (!target) throw new NotFoundError("Invoice not found.");
    authorize(user, "invoice:void", target.propertyId, { reason: data.reason });
    if (target.type !== "TAX_INVOICE") fail("Only a tax invoice can be corrected.");
    if (target.supersededById) fail("This bill was already corrected — open its current version.", ErrorCode.CONFLICT);

    const folio = await client.folio.findFirst({
      where: { id: target.folioId },
      select: {
        id: true, kind: true,
        lines: {
          select: { id: true, reversalOfId: true, businessDate: true, type: true, description: true, quantity: true, unitPaise: true, hsnSac: true, taxRateBps: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
          orderBy: { createdAt: "asc" },
        },
        payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } },
        reservation: { select: { source: true, extensions: { select: { fromDate: true, toDate: true, source: true } } } },
      },
    });
    if (!folio) throw new NotFoundError("Folio not found.");
    // An old whole-stay bill (part null) on a stay that is now split is corrected
    // into the guest's Direct bill; the OTA's nights get their own bill.
    const bill = billLines(folio, target.billPart, { fallbackToDirect: true });
    const billTo = {
      customerName: data.customerName, customerGstin: data.customerGstin ?? null, customerAddress: data.customerAddress ?? null,
      customerState: data.customerState ?? null, customerPhone: data.customerPhone ?? null, guestName: data.guestName ?? null,
    };

    const result = await withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        const current = await tx.invoice.findUnique({ where: { id: target.id }, select: { supersededById: true } });
        if (current?.supersededById) fail("This bill was just corrected by someone else — reload and try again.", ErrorCode.CONFLICT);
        if (await tx.invoice.findFirst({ where: { cancelsInvoiceId: target.id }, select: { id: true } })) {
          fail("This bill was cancelled with a credit note — generate the bill again instead (it keeps the number).");
        }
        const top = await tx.invoice.aggregate({ where: { number: target.number, propertyId: target.propertyId }, _max: { revision: true } });
        const revision = (top._max.revision ?? 0) + 1;
        const { invoiceId } = await insertInvoice(tx, {
          propertyId: target.propertyId, folioId: folio.id, number: target.number, revision, financialYear: target.financialYear,
          billPart: bill.billPart, billTo, placeOfSupply: target.placeOfSupply, issuedAt: target.issuedAt, issuedById: user.userId,
          taxable: bill.taxable, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst, totalPaise: bill.totalPaise, lines: bill.lines,
          supersedes: [target.id], action: "invoice:revise", reason: data.reason, manual: folio.kind === "MANUAL",
        });
        return { invoiceId, revision };
      }),
    );

    await attachInvoicePdf(result.invoiceId, folio.id, {
      number: target.number, issuedAt: target.issuedAt, ...billTo, placeOfSupply: target.placeOfSupply,
      taxablePaise: Number(bill.taxable), cgstPaise: bill.cgst, sgstPaise: bill.sgst, igstPaise: bill.igst,
      totalPaise: Number(bill.totalPaise), billPart: bill.billPart,
    });
    return { invoiceId: result.invoiceId, number: target.number, revision: result.revision, totalPaise: Number(bill.totalPaise) };
  });
}
