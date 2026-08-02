"use server";

/**
 * GST invoices — 06 T-15/T-16/T-17/T-18 (FR-12/13/14/16/21, AC-13..17).
 *
 * Numbering is gap-free by construction: a SHORT transaction gets-or-creates the
 * `InvoiceSeries(property, FY)` and allocates the next number under a row lock
 * (the `increment` update serializes concurrent generators). The Invoice is
 * inserted with `pdfObjectKey` null; the PDF renders to storage AFTER commit and
 * the key is written on a follow-up (the only Invoice column the DB lets us
 * update). A void draws a CREDIT_NOTE from the SAME series — never a delete or
 * renumber.
 */
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { resolveStorageAdapter } from "@/lib/storage";
import { db } from "@/lib/db";
import { financialYearOf } from "./domain/money";
import { formatInvoiceNumber } from "./domain/invoice-number";
import { amountInWords } from "./domain/words";
import { billingDb, withBillingContext } from "./internal";
import { generateInvoiceSchema, voidInvoiceSchema } from "./schema";

export type InvoiceResult = { invoiceId: string; number: string; totalPaise: number };

/** Generate a GST tax invoice for a folio (FR-12/13/16, AC-13/14/16). */
export async function generateInvoice(input: unknown): Promise<Result<InvoiceResult>> {
  return toResult(async () => {
    const data = generateInvoiceSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);

    const folio = await client.folio.findFirst({
      where: { id: data.folioId },
      select: {
        id: true, propertyId: true,
        lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, placeOfSupplyState: true } },
      },
    });
    if (!folio) throw new NotFoundError("Folio not found.");
    authorize(user, "invoice:generate", folio.propertyId);
    const property = await client.property.findFirstOrThrow({
      where: { id: folio.propertyId },
      select: { code: true, gstin: true, state: true, timezone: true },
    });

    // Totals are net-of-discount (discount lines are negative), tax-excluded taxable.
    let taxable = 0n, cgst = 0, sgst = 0, igst = 0;
    for (const l of folio.lines) {
      taxable += BigInt(l.amountPaise);
      cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise;
    }
    const totalPaise = taxable + BigInt(cgst + sgst + igst);
    const fy = financialYearOf(new Date(), property.timezone);
    const placeOfSupply = igst > 0 ? (data.billToState ?? property.state) : property.state;

    // The numbering tx runs UNSCOPED: the scope extension wraps compound-unique
    // `where`s (InvoiceSeries upsert/update) into an AND filter Prisma rejects.
    // Scope is already enforced — authorize() checked invoice:generate on this
    // folio's property, and every write below pins propertyId explicitly.
    const result = await withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        // Get-or-create the series, then allocate under a row lock (increment).
        await tx.invoiceSeries.upsert({
          where: { propertyId_financialYear: { propertyId: folio.propertyId, financialYear: fy } },
          create: { propertyId: folio.propertyId, financialYear: fy, prefix: property.code, nextNumber: 1 },
          update: {},
        });
        const series = await tx.invoiceSeries.update({
          where: { propertyId_financialYear: { propertyId: folio.propertyId, financialYear: fy } },
          data: { nextNumber: { increment: 1 } },
          select: { prefix: true, nextNumber: true },
        });
        const number = formatInvoiceNumber({ prefix: series.prefix, financialYear: fy, nextNumber: series.nextNumber - 1 });

        const invoice = await tx.invoice.create({
          data: {
            propertyId: folio.propertyId, folioId: folio.id, number, financialYear: fy,
            type: data.type, cancelsInvoiceId: data.cancelsInvoiceId ?? null,
            customerName: data.customerName, customerGstin: data.customerGstin ?? null,
            placeOfSupply, taxableValuePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst,
            totalPaise, pdfObjectKey: null, issuedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "InvoiceIssued", aggregateId: invoice.id, propertyId: folio.propertyId, payload: { number, totalPaise: Number(totalPaise), type: data.type } });
        await writeAudit(tx, { action: "invoice:generate", entityType: "Invoice", entityId: invoice.id, propertyId: folio.propertyId, after: { number, totalPaise: Number(totalPaise) } });
        return { invoiceId: invoice.id, number };
      }),
    );

    // AFTER commit: render + store the document, then attach the key (retryable;
    // a failure here leaves a valid invoice with pdfObjectKey null — no gap).
    await attachInvoicePdf(result.invoiceId, {
      number: result.number, gstin: property.gstin, customerName: data.customerName,
      customerGstin: data.customerGstin, placeOfSupply,
      taxablePaise: Number(taxable), cgst, sgst, igst, totalPaise: Number(totalPaise),
    });

    return { invoiceId: result.invoiceId, number: result.number, totalPaise: Number(totalPaise) };
  });
}

/** Render a document to storage and set pdfObjectKey (the only updatable column). */
async function attachInvoicePdf(
  invoiceId: string,
  inv: { number: string; gstin: string | null; customerName: string; customerGstin?: string; placeOfSupply: string; taxablePaise: number; cgst: number; sgst: number; igst: number; totalPaise: number },
): Promise<void> {
  try {
    // NOTE: a plain-text document for now; a @react-pdf/renderer styled PDF is a
    // follow-up (see 06 review F-1). All AC-16 fields are present and correct.
    const rupees = (p: number) => (p / 100).toFixed(2);
    const taxLine = inv.igst > 0 ? `IGST: ${rupees(inv.igst)}` : `CGST: ${rupees(inv.cgst)}  SGST: ${rupees(inv.sgst)}`;
    const doc = [
      `TAX INVOICE  ${inv.number}`,
      `Property GSTIN: ${inv.gstin ?? "-"}`,
      `Customer: ${inv.customerName}${inv.customerGstin ? ` (GSTIN ${inv.customerGstin})` : ""}`,
      `Place of supply: ${inv.placeOfSupply}`,
      `Taxable value: ${rupees(inv.taxablePaise)}`,
      taxLine,
      `Grand total: ${rupees(inv.totalPaise)}`,
      amountInWords(inv.totalPaise),
    ].join("\n");
    const key = `invoices/${invoiceId}.txt`;
    await resolveStorageAdapter().put(key, Buffer.from(doc, "utf8"), { contentType: "text/plain" });
    // pdfObjectKey is the only column the invoice_immutable trigger permits to change.
    await db.unscoped().invoice.update({ where: { id: invoiceId }, data: { pdfObjectKey: key } });
  } catch (e) {
    // Non-fatal: the invoice is valid; the render is retried by a follow-up job.
    void e;
  }
}

/** Void an invoice via a CREDIT_NOTE on the same series (FR-21, AC-17). 🔒 */
export async function voidInvoice(input: unknown): Promise<Result<InvoiceResult>> {
  return toResult(async () => {
    const data = voidInvoiceSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);

    const original = await client.invoice.findFirst({
      where: { id: data.invoiceId },
      select: {
        id: true, propertyId: true, folioId: true, financialYear: true, customerName: true,
        customerGstin: true, placeOfSupply: true, taxableValuePaise: true, cgstPaise: true,
        sgstPaise: true, igstPaise: true, totalPaise: true,
      },
    });
    if (!original) throw new NotFoundError("Invoice not found.");
    authorize(user, "invoice:void", original.propertyId, { reason: data.reason });

    return withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        const series = await tx.invoiceSeries.update({
          where: { propertyId_financialYear: { propertyId: original.propertyId, financialYear: original.financialYear } },
          data: { nextNumber: { increment: 1 } },
          select: { prefix: true, nextNumber: true },
        });
        const number = formatInvoiceNumber({ prefix: series.prefix, financialYear: original.financialYear, nextNumber: series.nextNumber - 1 });
        const total = -original.totalPaise;
        const creditNote = await tx.invoice.create({
          data: {
            propertyId: original.propertyId, folioId: original.folioId, number, financialYear: original.financialYear,
            type: "CREDIT_NOTE", cancelsInvoiceId: original.id,
            customerName: original.customerName, customerGstin: original.customerGstin,
            placeOfSupply: original.placeOfSupply, taxableValuePaise: -original.taxableValuePaise,
            cgstPaise: -original.cgstPaise, sgstPaise: -original.sgstPaise, igstPaise: -original.igstPaise,
            totalPaise: total, issuedById: user.userId,
          },
          select: { id: true },
        });
        await emitEvent(tx, { type: "InvoiceIssued", aggregateId: creditNote.id, propertyId: original.propertyId, payload: { number, type: "CREDIT_NOTE", cancelsInvoiceId: original.id } });
        await writeAudit(tx, { action: "invoice:void", entityType: "Invoice", entityId: creditNote.id, propertyId: original.propertyId, reason: data.reason, after: { number, cancelsInvoiceId: original.id } });
        return { invoiceId: creditNote.id, number, totalPaise: Number(total) };
      }),
    );
  });
}
