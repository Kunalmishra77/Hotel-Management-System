"use server";

/**
 * Manual bills — specs/06 FR-MB-1 (client, 22 Nov 2026): a GST bill for a
 * customer who did not stay (or anything billed outside a booking). Staff pick the
 * hotel, the bill date and the customer, type the lines, and may type the bill
 * number. Each manual bill is its own `kind=MANUAL` folio with append-only lines;
 * no room, availability or occupancy is touched. A correction reverses the lines,
 * posts the new ones and issues the next revision of the SAME number (FR-RV-1).
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { authorize } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { DomainError, ErrorCode, NotFoundError } from "@/lib/errors";
import { toResult, type Result } from "@/lib/result";
import { db } from "@/lib/db";
import { isValidGstin, normalizeGstin } from "@/lib/gstin";
import { financialYearOf } from "./domain/money";
import { manualLine, manualRoundOff, type ManualLine } from "./domain/manual-bill";
import { attachInvoicePdf } from "./invoice-pdf-store";
import { claimInvoiceNumber, insertInvoice } from "./invoice-issue";
import { billingDb, withBillingContext } from "./internal";
import { billToFields } from "./schema";

const lineSchema = z.object({
  description: z.string().trim().min(1).max(200),
  hsnSac: z.string().trim().max(10).optional(),
  quantity: z.coerce.number().int().min(1).max(999),
  ratePaise: z.coerce.number().int().positive().max(1_000_000_000),
  gstBps: z.coerce.number().int().refine((v) => [0, 500, 1200, 1800, 2800].includes(v), "GST must be 0, 5, 12, 18 or 28%"),
  inclusive: z.boolean().default(false),
});
const billSchema = {
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  customerName: z.string().trim().min(1).max(200),
  customerGstin: z.string().optional().transform((v) => (v ? normalizeGstin(v) : undefined))
    .refine((v) => v === undefined || isValidGstin(v), "GSTIN must be 15 characters, e.g. 07AAHCT9474D1Z0"),
  ...billToFields,
  lines: z.array(lineSchema).min(1).max(30),
};
const createSchema = z.object({
  propertyId: z.string().min(1),
  ...billSchema,
  seq: z.coerce.number().int().positive().max(9_999_999).optional(),
  /** Mark the bill paid in full in this mode (optional). */
  paidMode: z.enum(["CASH", "CREDIT_CARD", "DEBIT_CARD", "UPI", "BANK_TRANSFER", "ONLINE"]).optional(),
});
const correctSchema = z.object({ invoiceId: z.string().min(1), ...billSchema, reason: z.string().trim().min(1).max(300) });

export type ManualBillResult = { invoiceId: string; number: string; revision: number; totalPaise: number };

const fail = (msg: string, code: ErrorCode = ErrorCode.VALIDATION_FAILED): never => {
  throw new DomainError(code, msg, { publicMessage: msg });
};
const businessDate = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
/** The bill's instant: noon India time on the bill date (today → now). */
const issuedAtFor = (ymd: string, todayYmd: string) => (ymd === todayYmd ? new Date() : new Date(`${ymd}T12:00:00+05:30`));

function computeLines(lines: z.infer<typeof lineSchema>[], state: string) {
  const computed: ManualLine[] = lines.map((l) => manualLine(l, state));
  const roundOff = manualRoundOff(lines, computed);
  let taxable = 0n, cgst = 0, sgst = 0, igst = 0;
  for (const l of computed) { taxable += BigInt(l.amountPaise); cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise; }
  const totalPaise = taxable + BigInt(cgst + sgst + igst + roundOff);
  if (totalPaise <= 0n) fail("The bill total must be more than ₹0.");
  return { computed, roundOff, taxable, cgst, sgst, igst, totalPaise };
}

type Tx = Parameters<Parameters<ReturnType<typeof db.unscoped>["$transaction"]>[0]>[0];

/** Post the computed lines (+ round-off) to the manual folio; returns the snapshot lines. */
async function postLines(tx: Tx, folioId: string, date: Date, userId: string, c: ReturnType<typeof computeLines>, state: string) {
  const rows = [
    ...c.computed.map((l) => ({ ...l, type: "MISC" as const })),
    ...(c.roundOff !== 0 ? [{ type: "MISC" as const, description: "Round off", hsnSac: null, quantity: 1, unitPaise: c.roundOff, amountPaise: c.roundOff, taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0 }] : []),
  ];
  const out = [];
  for (const r of rows) {
    const line = await tx.folioLine.create({
      data: {
        folioId, type: r.type, description: r.description, quantity: r.quantity, unitPaise: r.unitPaise, amountPaise: BigInt(r.amountPaise),
        taxRateBps: r.taxRateBps, cgstPaise: r.cgstPaise, sgstPaise: r.sgstPaise, igstPaise: r.igstPaise, hsnSac: r.hsnSac,
        placeOfSupplyState: state, businessDate: date, postedById: userId,
      },
      select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true },
    });
    out.push(line);
  }
  return out;
}

const billToOf = (d: z.infer<typeof createSchema> | z.infer<typeof correctSchema>) => ({
  customerName: d.customerName, customerGstin: d.customerGstin ?? null, customerAddress: d.customerAddress ?? null,
  customerState: d.customerState ?? null, customerPhone: d.customerPhone ?? null, guestName: d.guestName ?? null,
});

export async function createManualBill(input: unknown): Promise<Result<ManualBillResult>> {
  return toResult(async () => {
    const data = createSchema.parse(input);
    const user = await requireUser();
    authorize(user, "invoice:generate", data.propertyId);
    authorize(user, "folio:charge", data.propertyId);
    const property = await billingDb(user).property.findFirst({ where: { id: data.propertyId }, select: { state: true, timezone: true } });
    if (!property) throw new NotFoundError("Hotel not found.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: property.timezone });
    if (data.billDate > today) fail("A bill can't be dated in the future.");
    const issuedAt = issuedAtFor(data.billDate, today);
    const fy = financialYearOf(issuedAt, property.timezone);
    const c = computeLines(data.lines, property.state);
    const billTo = billToOf(data);

    const result = await withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        const folio = await tx.folio.create({ data: { propertyId: data.propertyId, kind: "MANUAL", reservationId: null, isClosed: true }, select: { id: true } });
        const lines = await postLines(tx, folio.id, businessDate(data.billDate), user.userId, c, property.state);
        await writeAudit(tx, { action: "folio:open-manual-bill", entityType: "Folio", entityId: folio.id, propertyId: data.propertyId, after: { lines: lines.length, totalPaise: Number(c.totalPaise) } });
        if (data.paidMode) {
          const batchId = randomUUID();
          await tx.payment.create({ data: { propertyId: data.propertyId, folioId: folio.id, mode: data.paidMode, amountPaise: c.totalPaise, reference: "Manual bill", settlementBatchId: batchId, isRefund: false, receivedById: user.userId } });
          await emitEvent(tx, { type: "PaymentReceived", aggregateId: folio.id, propertyId: data.propertyId, payload: { folioId: folio.id, settlementBatchId: batchId, tenders: [{ mode: data.paidMode, amountPaise: Number(c.totalPaise) }] } });
        }
        const { number, revision } = await claimInvoiceNumber(tx, { orgId: user.orgId, financialYear: fy, folioId: folio.id, billPart: "DIRECT", ...(data.seq !== undefined ? { seq: data.seq } : {}) });
        const { invoiceId } = await insertInvoice(tx, {
          propertyId: data.propertyId, folioId: folio.id, number, revision, financialYear: fy, billPart: "DIRECT", billTo,
          placeOfSupply: property.state, issuedAt, issuedById: user.userId, taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst,
          totalPaise: c.totalPaise, lines, action: "invoice:manual-bill", manual: true,
          ...(data.seq !== undefined ? { reason: `bill number typed: ${number}` } : {}),
        });
        return { invoiceId, number, revision, folioId: folio.id };
      }),
    );
    await attachInvoicePdf(result.invoiceId, result.folioId, {
      number: result.number, issuedAt, ...billTo, placeOfSupply: property.state,
      taxablePaise: Number(c.taxable), cgstPaise: c.cgst, sgstPaise: c.sgst, igstPaise: c.igst, totalPaise: Number(c.totalPaise), billPart: "DIRECT",
    });
    return { invoiceId: result.invoiceId, number: result.number, revision: result.revision, totalPaise: Number(c.totalPaise) };
  });
}

/** Correct a manual bill: same number, next revision; old lines reversed, new lines posted. */
export async function correctManualBill(input: unknown): Promise<Result<ManualBillResult>> {
  return toResult(async () => {
    const data = correctSchema.parse(input);
    const user = await requireUser();
    const client = billingDb(user);
    const target = await client.invoice.findFirst({
      where: { id: data.invoiceId },
      select: { id: true, propertyId: true, folioId: true, number: true, financialYear: true, type: true, supersededById: true, folio: { select: { kind: true } } },
    });
    if (!target || target.folio.kind !== "MANUAL") throw new NotFoundError("Manual bill not found.");
    authorize(user, "invoice:void", target.propertyId, { reason: data.reason });
    if (target.type !== "TAX_INVOICE" || target.supersededById) fail("This bill was already corrected — open its current version.", ErrorCode.CONFLICT);
    const property = await client.property.findFirstOrThrow({ where: { id: target.propertyId }, select: { state: true, timezone: true } });
    const today = new Date().toLocaleDateString("en-CA", { timeZone: property.timezone });
    if (data.billDate > today) fail("A bill can't be dated in the future.");
    const issuedAt = issuedAtFor(data.billDate, today);
    if (financialYearOf(issuedAt, property.timezone) !== target.financialYear) fail(`The bill date must stay in financial year ${target.financialYear} — the bill number belongs to it.`);
    const c = computeLines(data.lines, property.state);
    const billTo = billToOf(data);

    const result = await withBillingContext(user, () =>
      db.unscoped().$transaction(async (tx) => {
        const current = await tx.invoice.findUnique({ where: { id: target.id }, select: { supersededById: true } });
        if (current?.supersededById) fail("This bill was just corrected by someone else — reload and try again.", ErrorCode.CONFLICT);
        // Reverse every still-active line (append-only folio: a reversal, never an edit).
        const existing = await tx.folioLine.findMany({ where: { folioId: target.folioId }, select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, reversalOfId: true, placeOfSupplyState: true } });
        const reversed = new Set(existing.map((l) => l.reversalOfId).filter(Boolean));
        for (const l of existing.filter((x) => x.type !== "REVERSAL" && !reversed.has(x.id))) {
          await tx.folioLine.create({
            data: {
              folioId: target.folioId, type: "REVERSAL", description: `Correction of: ${l.description}`, quantity: l.quantity, unitPaise: -l.unitPaise,
              amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
              hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState, businessDate: businessDate(data.billDate), reversalOfId: l.id, postedById: user.userId,
            },
          });
        }
        const lines = await postLines(tx, target.folioId, businessDate(data.billDate), user.userId, c, property.state);
        const top = await tx.invoice.aggregate({ where: { number: target.number, propertyId: target.propertyId }, _max: { revision: true } });
        const revision = (top._max.revision ?? 0) + 1;
        const { invoiceId } = await insertInvoice(tx, {
          propertyId: target.propertyId, folioId: target.folioId, number: target.number, revision, financialYear: target.financialYear,
          billPart: "DIRECT", billTo, placeOfSupply: property.state, issuedAt, issuedById: user.userId,
          taxable: c.taxable, cgst: c.cgst, sgst: c.sgst, igst: c.igst, totalPaise: c.totalPaise, lines,
          supersedes: [target.id], action: "invoice:revise", reason: data.reason, manual: true,
        });
        return { invoiceId, revision };
      }),
    );
    await attachInvoicePdf(result.invoiceId, target.folioId, {
      number: target.number, issuedAt, ...billTo, placeOfSupply: property.state,
      taxablePaise: Number(c.taxable), cgstPaise: c.cgst, sgstPaise: c.sgst, igstPaise: c.igst, totalPaise: Number(c.totalPaise), billPart: "DIRECT",
    });
    return { invoiceId: result.invoiceId, number: target.number, revision: result.revision, totalPaise: Number(c.totalPaise) };
  });
}
