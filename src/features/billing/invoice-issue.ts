/**
 * Shared invoice issuing internals (NOT "use server") — specs/06 FR-RV-1..3, FR-MB-1/2.
 *
 * Three callers issue a tax invoice: generate (first bill of a folio part),
 * revise ("Correct bill" — the next revision of the SAME number) and the manual
 * bill. They share: which folio lines a bill covers (`billLines`), which number +
 * revision a bill may take (`claimInvoiceNumber`), and the insert itself
 * (`insertInvoice`: row + frozen line snapshot + supersede + event + audit).
 */
import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode } from "@/lib/errors";
import { assignParts, billParts, billPartLabel, type PartContext } from "./domain/bill-parts";
import { decideNumberClaim, formatInvoiceNumber, type NumberHolder } from "./domain/invoice-number";

type Tx = Prisma.TransactionClient;

export type BillLine = {
  id: string; type: string; description: string; quantity: number; unitPaise: number; amountPaise: bigint;
  taxRateBps: number; cgstPaise: number; sgstPaise: number; igstPaise: number; hsnSac: string | null;
};
type FolioForBill = {
  id: string;
  lines: (BillLine & { reversalOfId: string | null; businessDate: Date })[];
  payments: { mode: string; reference: string | null; amountPaise: bigint; isRefund: boolean }[];
  reservation: { source: string; extensions: { fromDate: Date; toDate: Date; source: string }[] } | null;
};

const fail = (msg: string, code: ErrorCode = ErrorCode.VALIDATION_FAILED): never => {
  throw new DomainError(code, msg, { publicMessage: msg });
};

/**
 * The active lines + totals of one bill of a folio. `requestedPart` picks a bill of
 * a split stay; omitted on a split stay it is refused (each bill on its own), and
 * `fallbackToDirect` lets a correction of an old whole-stay invoice land on the
 * guest's Direct bill. Reversed pairs net to zero and are left out; the whole-rupee
 * "Round off" line adjusts the total but is not taxable value.
 */
export function billLines(folio: FolioForBill, requestedPart?: string | null, opts: { fallbackToDirect?: boolean } = {}) {
  const ctx: PartContext = { bookingSource: folio.reservation?.source ?? null, extensions: folio.reservation?.extensions ?? [] };
  const parts = billParts(folio.lines, folio.payments, ctx).filter((p) => p.lineIds.length > 0);
  let billPart: string;
  if (requestedPart) {
    if (!parts.some((p) => p.part === requestedPart)) fail(`This stay has no ${billPartLabel(requestedPart)} charges to invoice.`);
    billPart = requestedPart;
  } else if (parts.length > 1) {
    if (opts.fallbackToDirect && parts.some((p) => p.part === "DIRECT")) billPart = "DIRECT";
    else return fail(`This stay has separate bills (${parts.map((p) => p.label).join(" and ")}) — generate each one on its own.`);
  } else {
    billPart = parts[0]?.part ?? "DIRECT";
  }
  const assigned = assignParts(folio.lines, ctx);
  const reversedIds = new Set(folio.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
  const lines = folio.lines.filter((l) => l.type !== "REVERSAL" && !reversedIds.has(l.id) && assigned.get(l.id) === billPart);
  let taxable = 0n, cgst = 0, sgst = 0, igst = 0, roundOff = 0n;
  for (const l of lines) {
    if (l.type === "MISC" && l.description === "Round off") { roundOff += BigInt(l.amountPaise); continue; }
    taxable += BigInt(l.amountPaise);
    cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise;
  }
  const totalPaise = taxable + BigInt(cgst + sgst + igst) + roundOff;
  if (totalPaise === 0n) fail("No charges to invoice — add charges to the folio first.");
  return { billPart, lines, taxable, cgst, sgst, igst, totalPaise };
}

/** Rows already carrying `number` in this org, with their live state. */
async function holdersOf(tx: Tx, propertyIds: string[], number: string): Promise<(NumberHolder & { id: string })[]> {
  const rows = await tx.invoice.findMany({
    where: { number, propertyId: { in: propertyIds } },
    select: { id: true, folioId: true, billPart: true, type: true, revision: true, supersededById: true },
  });
  if (rows.length === 0) return [];
  const credited = new Set(
    (await tx.invoice.findMany({ where: { cancelsInvoiceId: { in: rows.map((r) => r.id) } }, select: { cancelsInvoiceId: true } }))
      .map((c) => c.cancelsInvoiceId),
  );
  return rows.map((r) => ({ ...r, live: r.type === "TAX_INVOICE" && !r.supersededById && !credited.has(r.id) }));
}

/**
 * The number + revision for a new tax invoice of (folio, bill part). Runs inside
 * the issuing transaction and LOCKS the company series row first, so two
 * concurrent issuers can never take the same number.
 *  - `seq` typed by staff → that number if `decideNumberClaim` allows it;
 *  - otherwise this bill's own earlier (cancelled) number, if it has one — one
 *    customer, one bill number (FR-RV-2);
 *  - otherwise the next free number of the series (numbers already taken by a
 *    typed entry are skipped).
 */
export async function claimInvoiceNumber(
  tx: Tx,
  input: { orgId: string; financialYear: string; folioId: string; billPart: string; seq?: number },
): Promise<{ number: string; revision: number }> {
  const key = { orgId_financialYear: { orgId: input.orgId, financialYear: input.financialYear } };
  await tx.companyInvoiceSeries.upsert({ where: key, create: { orgId: input.orgId, financialYear: input.financialYear, prefix: "WASPL", nextNumber: 1 }, update: {} });
  const series = await tx.companyInvoiceSeries.update({ where: key, data: { nextNumber: { increment: 0 } }, select: { prefix: true, nextNumber: true } }); // row lock
  const propertyIds = (await tx.property.findMany({ where: { orgId: input.orgId }, select: { id: true } })).map((p) => p.id);
  const fmt = (n: number) => formatInvoiceNumber({ prefix: series.prefix, financialYear: input.financialYear, nextNumber: n });
  const target = { folioId: input.folioId, billPart: input.billPart };

  if (input.seq !== undefined) {
    const number = fmt(input.seq);
    const claim = decideNumberClaim(await holdersOf(tx, propertyIds, number), target);
    if (!claim.ok) {
      fail(claim.reason === "live"
        ? `Bill ${number} is already this stay's live bill — use "Correct bill" on it.`
        : `Bill number ${number} is already used by another bill. Pick a different number.`, ErrorCode.CONFLICT);
    }
    return { number, revision: (claim as { revision: number }).revision };
  }

  const earlier = await tx.invoice.findMany({
    where: { folioId: input.folioId, type: "TAX_INVOICE", OR: [{ billPart: input.billPart }, { billPart: null }] },
    select: { number: true }, orderBy: { issuedAt: "asc" },
  });
  for (const e of earlier) {
    const claim = decideNumberClaim(await holdersOf(tx, propertyIds, e.number), target);
    if (claim.ok) return { number: e.number, revision: claim.revision };
  }

  return { number: await nextFreeNumber(tx, { orgId: input.orgId, financialYear: input.financialYear }), revision: 0 };
}

/**
 * The next free number of the company series (locks the series row), skipping any
 * number a typed entry already took. Used for new bills and credit notes.
 */
export async function nextFreeNumber(tx: Tx, input: { orgId: string; financialYear: string }): Promise<string> {
  const key = { orgId_financialYear: { orgId: input.orgId, financialYear: input.financialYear } };
  await tx.companyInvoiceSeries.upsert({ where: key, create: { orgId: input.orgId, financialYear: input.financialYear, prefix: "WASPL", nextNumber: 1 }, update: {} });
  const series = await tx.companyInvoiceSeries.update({ where: key, data: { nextNumber: { increment: 0 } }, select: { prefix: true, nextNumber: true } });
  const propertyIds = (await tx.property.findMany({ where: { orgId: input.orgId }, select: { id: true } })).map((p) => p.id);
  let next = series.nextNumber;
  for (;;) {
    const number = formatInvoiceNumber({ prefix: series.prefix, financialYear: input.financialYear, nextNumber: next });
    next += 1;
    const taken = await tx.invoice.count({ where: { number, propertyId: { in: propertyIds } } });
    if (taken === 0) {
      await tx.companyInvoiceSeries.update({ where: key, data: { nextNumber: next } });
      return number;
    }
  }
}

export type BillTo = {
  customerName: string; customerGstin?: string | null; customerAddress?: string | null;
  customerState?: string | null; customerPhone?: string | null; guestName?: string | null;
};

/** Insert a tax invoice (+ frozen line snapshot), supersede earlier revisions, emit + audit. */
export async function insertInvoice(
  tx: Tx,
  input: {
    propertyId: string; folioId: string; number: string; revision: number; financialYear: string;
    billPart: string; billTo: BillTo; placeOfSupply: string; issuedAt?: Date; issuedById: string;
    taxable: bigint; cgst: number; sgst: number; igst: number; totalPaise: bigint;
    lines: BillLine[]; supersedes?: string[]; action: string; reason?: string; manual?: boolean;
  },
): Promise<{ invoiceId: string }> {
  const b = input.billTo;
  const invoice = await tx.invoice.create({
    data: {
      propertyId: input.propertyId, folioId: input.folioId, number: input.number, revision: input.revision,
      financialYear: input.financialYear, type: "TAX_INVOICE", billPart: input.billPart,
      customerName: b.customerName, customerGstin: b.customerGstin || null, customerAddress: b.customerAddress || null,
      customerState: b.customerState || null, customerPhone: b.customerPhone || null, guestName: b.guestName || null,
      placeOfSupply: input.placeOfSupply, taxableValuePaise: input.taxable, cgstPaise: input.cgst, sgstPaise: input.sgst,
      igstPaise: input.igst, totalPaise: input.totalPaise, pdfObjectKey: null, issuedById: input.issuedById,
      ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
    },
    select: { id: true },
  });
  if (input.lines.length > 0) {
    await tx.invoiceLine.createMany({
      data: input.lines.map((l, idx) => ({
        invoiceId: invoice.id, type: String(l.type), description: l.description, quantity: l.quantity,
        unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: idx,
      })),
    });
  }
  if (input.supersedes?.length) {
    // Write-once (the trigger refuses a re-point); a row superseded meanwhile is a race → abort.
    const res = await tx.invoice.updateMany({ where: { id: { in: input.supersedes }, supersededById: null }, data: { supersededById: invoice.id, supersededAt: new Date() } });
    if (res.count !== input.supersedes.length) fail("This bill was just corrected by someone else — reload and try again.", ErrorCode.CONFLICT);
  }
  const totalPaise = Number(input.totalPaise);
  await emitEvent(tx, { type: "InvoiceIssued", aggregateId: invoice.id, propertyId: input.propertyId, payload: { number: input.number, revision: input.revision, totalPaise, type: "TAX_INVOICE", billPart: input.billPart, ...(input.manual ? { manual: true } : {}) } });
  await writeAudit(tx, {
    action: input.action, entityType: "Invoice", entityId: invoice.id, propertyId: input.propertyId,
    ...(input.reason ? { reason: input.reason } : {}),
    after: { number: input.number, revision: input.revision, totalPaise, billPart: input.billPart, supersedes: input.supersedes ?? [] },
  });
  return { invoiceId: invoice.id };
}
