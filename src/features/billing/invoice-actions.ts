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
import { authorize, hasPermission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { financialYearOf } from "./domain/money";
import { formatInvoiceNumber } from "./domain/invoice-number";
import { attachInvoicePdf } from "./invoice-pdf-store";
import { billingDb, withBillingContext } from "./internal";
import { searchInvoices, type InvoiceListItem } from "./queries";
import { generateInvoiceSchema, voidInvoiceSchema } from "./schema";

export type InvoiceResult = { invoiceId: string; number: string; totalPaise: number };

/**
 * Searchable/filterable invoice list for the Billing page (Super-Admin sees it
 * across every accessible property). Search by customer name or invoice number;
 * filter by property and issue-date range. Property scope is enforced by
 * `db.scoped` inside `searchInvoices`; `folio:view` gates the read.
 */
export async function searchBillingInvoices(input: {
  keyword?: string;
  propertyId?: string;
  from?: string;
  to?: string;
  cursor?: string;
}): Promise<Result<{ invoices: InvoiceListItem[]; nextCursor: string | null }>> {
  return toResult(async () => {
    const user = await requireUser();
    authorize(user, "folio:view", user.activePropertyId);
    return searchInvoices(user, {
      keyword: input.keyword?.trim() || undefined,
      propertyId: input.propertyId || undefined,
      from: input.from ? new Date(`${input.from}T00:00:00.000Z`) : undefined,
      to: input.to ? new Date(`${input.to}T23:59:59.999Z`) : undefined,
      cursor: input.cursor || undefined,
      limit: 30,
    });
  });
}

/** Generate a GST tax invoice for a folio (FR-12/13/16, AC-13/14/16).
 *  `renderPdf` (default true) renders + stores the styled PDF inline; the go-live
 *  bulk import passes false so the CPU-heavy render doesn't block the request — the
 *  PDF then renders lazily on first download. */
export async function generateInvoice(input: unknown, opts: { renderPdf?: boolean } = {}): Promise<Result<InvoiceResult>> {
  const renderPdf = opts.renderPdf !== false;
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

    // AFTER commit: render + store the styled PDF (retryable; a failure leaves a
    // valid invoice with pdfObjectKey null — it renders on first download). Skipped
    // for bulk import so the CPU-heavy render never blocks the request.
    if (renderPdf) {
      await attachInvoicePdf(result.invoiceId, folio.id, {
        number: result.number, issuedAt: new Date(),
        customerName: data.customerName, customerGstin: data.customerGstin ?? null, placeOfSupply,
        taxablePaise: Number(taxable), cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: Number(totalPaise),
      });
    }

    return { invoiceId: result.invoiceId, number: result.number, totalPaise: Number(totalPaise) };
  });
}

/**
 * Auto-issue the GST tax invoice for a reservation's folio at check-out.
 *
 * Room-nights are posted at check-out, so this is the correct moment to raise the
 * statutory invoice — previously it was only ever created by the manual folio
 * button, so a checked-out + paid stay left no invoice in the register (the
 * reported "billing not appearing" bug). Best-effort + idempotent: never throws
 * (check-out must not depend on it), skips folios that are empty or already
 * invoiced, and no-ops when the caller lacks `invoice:generate` — the manual
 * button stays available as the fallback.
 */
export async function autoIssueInvoiceOnCheckout(reservationId: string, opts: { renderPdf?: boolean } = {}): Promise<void> {
  try {
    const user = await requireUser();
    const folio = await billingDb(user).folio.findFirst({
      where: { reservationId },
      select: {
        id: true,
        lines: { select: { id: true }, take: 1 },
        invoices: { where: { type: "TAX_INVOICE" }, select: { id: true }, take: 1 },
        reservation: { select: { guest: { select: { fullName: true, gstNumber: true } } } },
      },
    });
    if (!folio || folio.lines.length === 0 || folio.invoices.length > 0) return;
    if (!hasPermission(user, "invoice:generate")) return;
    const guest = folio.reservation?.guest;
    await generateInvoice({
      folioId: folio.id,
      customerName: guest?.fullName ?? "Guest",
      customerGstin: guest?.gstNumber ?? undefined,
    }, { renderPdf: opts.renderPdf !== false });
  } catch {
    // Non-fatal — the manual "Generate GST invoice" action remains the fallback.
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
