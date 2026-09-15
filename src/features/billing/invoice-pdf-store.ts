/**
 * Invoice PDF rendering + storage (plain module — NOT "use server", so it can be
 * imported by both the invoice action and the download route).
 *
 * Rendering a @react-pdf document is CPU-heavy and blocks Node's single thread,
 * so the go-live bulk import does NOT render inline (that stalled the next
 * request and bounced staff to the login screen). Instead the invoice ROW is
 * created immediately and the PDF is rendered lazily — on first download
 * (`ensureInvoicePdf`) — which happens rarely and one at a time.
 */
import { db } from "@/lib/db";
import { resolveStorageAdapter } from "@/lib/storage";
import { renderInvoicePdf } from "./invoice-pdf";

type PdfMeta = {
  number: string;
  issuedAt: Date;
  customerName: string;
  customerGstin?: string | null;
  placeOfSupply: string;
  taxablePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

/**
 * Render the styled GST invoice to storage and set `pdfObjectKey` (the only column
 * the invoice_immutable trigger permits to change). Best-effort — a failure leaves
 * a valid invoice with a null key, retried on the next download.
 */
export async function attachInvoicePdf(invoiceId: string, folioId: string, meta: PdfMeta): Promise<string | null> {
  try {
    const folio = await db.unscoped().folio.findFirst({
      where: { id: folioId },
      select: {
        propertyId: true,
        lines: {
          select: { description: true, hsnSac: true, quantity: true, unitPaise: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!folio) return null;
    const property = await db.unscoped().property.findFirst({
      where: { id: folio.propertyId },
      select: { name: true, addressLine1: true, city: true, state: true, pincode: true, gstin: true },
    });
    if (!property) return null;
    const bytes = await renderInvoicePdf({
      number: meta.number,
      issuedAt: meta.issuedAt,
      property,
      customerName: meta.customerName,
      customerGstin: meta.customerGstin ?? null,
      placeOfSupply: meta.placeOfSupply,
      lines: folio.lines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac,
        quantity: l.quantity,
        unitPaise: l.unitPaise,
        amountPaise: Number(l.amountPaise),
        cgstPaise: l.cgstPaise,
        sgstPaise: l.sgstPaise,
        igstPaise: l.igstPaise,
      })),
      taxablePaise: meta.taxablePaise,
      cgstPaise: meta.cgstPaise,
      sgstPaise: meta.sgstPaise,
      igstPaise: meta.igstPaise,
      totalPaise: meta.totalPaise,
    });
    const key = `invoices/${invoiceId}.pdf`;
    await resolveStorageAdapter().put(key, bytes, { contentType: "application/pdf" });
    await db.unscoped().invoice.update({ where: { id: invoiceId }, data: { pdfObjectKey: key } });
    return key;
  } catch {
    // Non-fatal: the invoice is valid; the render is retried on the next download.
    return null;
  }
}

/**
 * Return the stored PDF key for an invoice, rendering + storing it on the fly if it
 * has none yet (the lazy path for imports that skipped the inline render).
 */
export async function ensureInvoicePdf(invoiceId: string): Promise<string | null> {
  const inv = await db.unscoped().invoice.findFirst({
    where: { id: invoiceId },
    select: {
      id: true, folioId: true, pdfObjectKey: true, number: true, issuedAt: true,
      customerName: true, customerGstin: true, placeOfSupply: true,
      taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true,
    },
  });
  if (!inv) return null;
  if (inv.pdfObjectKey) return inv.pdfObjectKey;
  return attachInvoicePdf(inv.id, inv.folioId, {
    number: inv.number,
    issuedAt: inv.issuedAt,
    customerName: inv.customerName,
    customerGstin: inv.customerGstin,
    placeOfSupply: inv.placeOfSupply,
    taxablePaise: Number(inv.taxableValuePaise),
    cgstPaise: inv.cgstPaise,
    sgstPaise: inv.sgstPaise,
    igstPaise: inv.igstPaise,
    totalPaise: Number(inv.totalPaise),
  });
}
