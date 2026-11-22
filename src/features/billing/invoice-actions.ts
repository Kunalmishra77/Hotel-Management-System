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
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { financialYearOf } from "./domain/money";
import { billParts, isGuestBill, billPartLabel, type PartContext } from "./domain/bill-parts";
import { billLines, claimInvoiceNumber, insertInvoice, nextFreeNumber } from "./invoice-issue";
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
  gstOnly?: boolean;
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
      gstOnly: input.gstOnly === true,
      cursor: input.cursor || undefined,
      limit: 30,
    });
  });
}

/**
 * Share an issued invoice with the guest over WhatsApp and/or email (client req
 * #16). Reuses the 12-communications outbox via its public `sendManual` action —
 * one message per channel, best-effort: a channel with no guest address is skipped
 * and reported, never fatal. Delivery is sandbox-logged until the messaging
 * provider is activated (integrations.md); the message copy itself is real.
 */
export async function shareInvoice(input: {
  invoiceId: string;
  channels?: ("WHATSAPP" | "EMAIL")[];
}): Promise<Result<{ sent: string[]; skipped: string[] }>> {
  return toResult(async () => {
    const user = await requireUser();
    const invoice = await billingDb(user).invoice.findFirst({
      where: { id: input.invoiceId },
      select: {
        number: true, totalPaise: true, propertyId: true, billPart: true,
        folio: { select: { reservation: { select: { guestId: true } } } },
      },
    });
    if (!invoice) throw new NotFoundError("Invoice not found.");
    authorize(user, "folio:view", invoice.propertyId);
    // Only the direct bill goes to the guest; an OTA bill is the hotel's copy.
    if (!isGuestBill(invoice.billPart)) {
      const msg = `${invoice.number} is the ${billPartLabel(invoice.billPart)} bill — the hotel's copy. Only the Direct bill is shared with the guest.`;
      throw new DomainError(ErrorCode.VALIDATION_FAILED, msg, { publicMessage: msg });
    }
    const guestId = invoice.folio.reservation?.guestId;
    if (!guestId) throw new NotFoundError("This invoice has no guest to share with.");

    const { sendManual } = await import("@/features/communications/actions");
    const channels = input.channels?.length ? input.channels : (["WHATSAPP", "EMAIL"] as const);
    const context = {
      invoiceNumber: invoice.number,
      invoiceTotal: `₹${(Number(invoice.totalPaise) / 100).toLocaleString("en-IN")}`,
    };
    const sent: string[] = [];
    const skipped: string[] = [];
    for (const channel of channels) {
      const res = await sendManual({
        guestId,
        propertyId: invoice.propertyId,
        templateKey: "INVOICE_SHARE",
        channel,
        language: "en",
        context,
      });
      if (res.ok) sent.push(channel);
      else skipped.push(channel);
    }
    if (sent.length === 0) {
      throw new NotFoundError("Could not share — the guest has no WhatsApp number or email on file.");
    }
    return { sent, skipped };
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
        lines: {
          select: {
            id: true, reversalOfId: true, businessDate: true,
            type: true, description: true, quantity: true, unitPaise: true, hsnSac: true, taxRateBps: true,
            amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, placeOfSupplyState: true,
          },
          orderBy: { createdAt: "asc" },
        },
        payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } },
        reservation: { select: { source: true, extensions: { select: { fromDate: true, toDate: true, source: true } } } },
      },
    });
    if (!folio) throw new NotFoundError("Folio not found.");
    authorize(user, "invoice:generate", folio.propertyId);
    const property = await client.property.findFirstOrThrow({
      where: { id: folio.propertyId },
      select: { code: true, gstin: true, state: true, timezone: true },
    });

    // The bill's active lines + totals (one bill per channel on a split stay — bill-parts.ts).
    const bill = billLines(folio, data.billPart);
    const { billPart } = bill;
    const fy = financialYearOf(new Date(), property.timezone);
    const placeOfSupply = bill.igst > 0 ? (data.billToState ?? property.state) : property.state;
    const billTo = {
      customerName: data.customerName, customerGstin: data.customerGstin ?? null, customerAddress: data.customerAddress ?? null,
      customerState: data.customerState ?? null, customerPhone: data.customerPhone ?? null, guestName: data.guestName ?? null,
    };

    // The numbering tx runs UNSCOPED: compound-unique series writes don't survive the
    // scope extension. Scope is already enforced — authorize() checked
    // invoice:generate on this folio's property, and every write pins propertyId.
    const result = await withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        // One live tax invoice per bill (a second one double-counts the supply). A
        // correction goes through "Correct bill" (same number, next revision).
        // Checked INSIDE the transaction so a double-click can't race it. An older
        // whole-stay invoice (billPart null) covers every bill.
        const existing = await tx.invoice.findMany({ where: { folioId: folio.id, supersededById: null }, select: { id: true, number: true, type: true, cancelsInvoiceId: true, billPart: true } });
        const credited = new Set(existing.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
        const live = existing.find((i) => i.type === "TAX_INVOICE" && !credited.has(i.id) && (i.billPart === null || i.billPart === billPart));
        if (live) {
          const msg = `This bill already has invoice ${live.number}. Use "Correct bill" on it — it keeps the same number.`;
          throw new DomainError(ErrorCode.CONFLICT, msg, { publicMessage: msg });
        }
        const { number, revision } = await claimInvoiceNumber(tx, { orgId: user.orgId, financialYear: fy, folioId: folio.id, billPart, ...(data.seq !== undefined ? { seq: data.seq } : {}) });
        const { invoiceId } = await insertInvoice(tx, {
          propertyId: folio.propertyId, folioId: folio.id, number, revision, financialYear: fy, billPart, billTo,
          placeOfSupply, issuedById: user.userId, taxable: bill.taxable, cgst: bill.cgst, sgst: bill.sgst, igst: bill.igst,
          totalPaise: bill.totalPaise, lines: bill.lines, action: "invoice:generate",
          ...(data.seq !== undefined ? { reason: `bill number typed: ${number}` } : {}),
        });
        return { invoiceId, number };
      }),
    );
    const { taxable, cgst, sgst, igst, totalPaise } = bill;

    // AFTER commit: render + store the styled PDF (retryable; a failure leaves a
    // valid invoice with pdfObjectKey null — it renders on first download). Skipped
    // for bulk import so the CPU-heavy render never blocks the request.
    if (renderPdf) {
      await attachInvoicePdf(result.invoiceId, folio.id, {
        number: result.number, issuedAt: new Date(),
        ...billTo, placeOfSupply,
        taxablePaise: Number(taxable), cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: Number(totalPaise),
        billPart,
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
        lines: { select: { id: true, type: true, description: true, businessDate: true, reversalOfId: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
        payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } },
        invoices: { where: { supersededById: null }, select: { id: true, type: true, cancelsInvoiceId: true, billPart: true } },
        reservation: { select: { source: true, extensions: { select: { fromDate: true, toDate: true, source: true } }, guest: { select: { fullName: true, gstNumber: true } } } },
      },
    });
    if (!folio || folio.lines.length === 0) return;
    if (!hasPermission(user, "invoice:generate")) return;
    const credited = new Set(folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
    const live = folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !credited.has(i.id));
    if (live.some((i) => i.billPart === null)) return; // an older whole-stay invoice already covers it
    const ctx: PartContext = { bookingSource: folio.reservation?.source ?? null, extensions: folio.reservation?.extensions ?? [] };
    const parts = billParts(folio.lines, folio.payments, ctx).filter((p) => p.lineIds.length > 0 && p.chargesPaise !== 0);
    const guest = folio.reservation?.guest;
    // One invoice per bill (an OTA's nights / the direct bill), each best-effort.
    for (const p of parts) {
      if (live.some((i) => i.billPart === p.part)) continue;
      await generateInvoice({
        folioId: folio.id,
        customerName: guest?.fullName ?? "Guest",
        customerGstin: guest?.gstNumber ?? undefined,
        billPart: p.part,
      }, { renderPdf: opts.renderPdf !== false });
    }
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
        sgstPaise: true, igstPaise: true, totalPaise: true, billPart: true,
      },
    });
    if (!original) throw new NotFoundError("Invoice not found.");
    authorize(user, "invoice:void", original.propertyId, { reason: data.reason });

    // The original's frozen line snapshot → the credit note gets the SAME lines
    // negated, so the credit-note PDF is self-consistent (negative lines match the
    // negative totals) instead of rendering the live folio's positive lines.
    const originalLines = await client.invoiceLine.findMany({
      where: { invoiceId: original.id },
      orderBy: { sortOrder: "asc" },
      select: { type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true },
    });

    return withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        // Only a live TAX invoice can be voided, and only once — a double-click or a
        // stale tab must not issue a second credit note (books would go negative)
        // nor "void" a credit note. Re-checked inside the numbering transaction.
        const target = await tx.invoice.findUnique({ where: { id: original.id }, select: { type: true, supersededById: true } });
        if (target?.supersededById) {
          throw new DomainError(ErrorCode.CONFLICT, "This bill was corrected — cancel its current version instead.", { publicMessage: "This bill was corrected — cancel its current version instead." });
        }
        if (target?.type !== "TAX_INVOICE") {
          throw new DomainError(ErrorCode.VALIDATION_FAILED, "Only a tax invoice can be voided.", { publicMessage: "Only a tax invoice can be voided." });
        }
        const prior = await tx.invoice.findFirst({ where: { cancelsInvoiceId: original.id, type: "CREDIT_NOTE" }, select: { number: true } });
        if (prior) {
          const msg = `This invoice is already voided by credit note ${prior.number}.`;
          throw new DomainError(ErrorCode.CONFLICT, msg, { publicMessage: msg });
        }
        // Credit note draws its own number from the SAME company-wide series.
        const number = await nextFreeNumber(tx, { orgId: user.orgId, financialYear: original.financialYear });
        const total = -original.totalPaise;
        const creditNote = await tx.invoice.create({
          data: {
            propertyId: original.propertyId, folioId: original.folioId, number, financialYear: original.financialYear,
            type: "CREDIT_NOTE", cancelsInvoiceId: original.id,
            customerName: original.customerName, customerGstin: original.customerGstin,
            placeOfSupply: original.placeOfSupply, taxableValuePaise: -original.taxableValuePaise,
            cgstPaise: -original.cgstPaise, sgstPaise: -original.sgstPaise, igstPaise: -original.igstPaise,
            totalPaise: total, issuedById: user.userId, billPart: original.billPart,
          },
          select: { id: true },
        });
        if (originalLines.length > 0) {
          await tx.invoiceLine.createMany({
            data: originalLines.map((l, idx) => ({
              invoiceId: creditNote.id,
              type: l.type,
              description: l.description,
              quantity: l.quantity,
              unitPaise: l.unitPaise,
              amountPaise: -l.amountPaise,
              taxRateBps: l.taxRateBps,
              cgstPaise: -l.cgstPaise,
              sgstPaise: -l.sgstPaise,
              igstPaise: -l.igstPaise,
              hsnSac: l.hsnSac,
              sortOrder: idx,
            })),
          });
        }
        await emitEvent(tx, { type: "InvoiceIssued", aggregateId: creditNote.id, propertyId: original.propertyId, payload: { number, type: "CREDIT_NOTE", cancelsInvoiceId: original.id } });
        await writeAudit(tx, { action: "invoice:void", entityType: "Invoice", entityId: creditNote.id, propertyId: original.propertyId, reason: data.reason, after: { number, cancelsInvoiceId: original.id } });
        return { invoiceId: creditNote.id, number, totalPaise: Number(total) };
      }),
    );
  });
}
