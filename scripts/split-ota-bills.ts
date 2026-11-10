/**
 * Separate bills for every past stay (client, 10 Nov 2026: "sari purani bhi").
 *
 * A. Extensions: an OTA booking that was extended before extensions carried
 *    their own source credited the added nights to the OTA. Per the client, those
 *    extensions were taken at the desk → record each as DIRECT (or as the OTA it
 *    was prepaid on, when the extension's payment says "via Agoda" etc.). Ranges
 *    come from the `reservation:extend` audit trail; ranges already recorded are
 *    skipped.
 * B. Invoices: a stay whose folio now splits into more than one bill
 *    (bill-parts.ts — the OTA's nights vs everything paid at the hotel) but holds
 *    ONE older whole-stay invoice gets that invoice voided by a credit note and
 *    one new invoice PER BILL. Numbers come from the same company-wide gap-free
 *    series, allocated exactly as the app does; lines are snapshotted; PDFs render
 *    on first download. Nothing is deleted.
 *
 *   npx tsx scripts/split-ota-bills.ts                      (dry-run: lists everything)
 *   $env:CONFIRM="YES"; npx tsx scripts/split-ota-bills.ts  (apply)
 *   $env:CODES="BK-A,BK-B" narrows it to those bookings.
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { formatInvoiceNumber } from "../src/features/billing/domain/invoice-number";
import { financialYearOf } from "../src/features/billing/domain/money";
import { assignParts, billParts, OTA_SOURCES, type PartContext, type StaySpan } from "../src/features/billing/domain/bill-parts";

const APPLY = process.env.CONFIRM === "YES";
const CODES = (process.env.CODES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const LABEL_TO_SOURCE: Record<string, string> = { airbnb: "AIRBNB", "booking.com": "BOOKING_COM", agoda: "AGODA", makemytrip: "MAKEMYTRIP", goibibo: "GOIBIBO", expedia: "EXPEDIA" };
const isRoundOff = (l: { type: string; description: string }) => l.type === "MISC" && l.description === "Round off";

async function nextNumber(tx: Prisma.TransactionClient, orgId: string, fy: string): Promise<string> {
  await tx.companyInvoiceSeries.upsert({ where: { orgId_financialYear: { orgId, financialYear: fy } }, create: { orgId, financialYear: fy, prefix: "WASPL", nextNumber: 1 }, update: {} });
  const s = await tx.companyInvoiceSeries.update({ where: { orgId_financialYear: { orgId, financialYear: fy } }, data: { nextNumber: { increment: 1 } }, select: { prefix: true, nextNumber: true } });
  return formatInvoiceNumber({ prefix: s.prefix, financialYear: fy, nextNumber: s.nextNumber - 1 });
}

const SELECT = {
  id: true, code: true, status: true, source: true, propertyId: true, ratePaise: true,
  guest: { select: { fullName: true } },
  property: { select: { orgId: true, code: true, timezone: true } },
  extensions: { select: { fromDate: true, toDate: true, source: true } },
  folio: {
    select: {
      id: true,
      lines: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, reversalOfId: true, businessDate: true } },
      payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } },
      invoices: { select: { id: true, number: true, type: true, totalPaise: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, financialYear: true, customerName: true, customerGstin: true, placeOfSupply: true, cancelsInvoiceId: true, billPart: true, lines: { select: { type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true } } } },
    },
  },
} as const;
type Res = Prisma.ReservationGetPayload<{ select: typeof SELECT }>;

/** A — extensions to record, from the extend audit trail. */
async function plannedExtensions(r: Res): Promise<(StaySpan & { ratePaise: number })[]> {
  if (!OTA_SOURCES.has(r.source)) return [];
  const audits = await prisma.auditLog.findMany({ where: { entityId: r.id, action: "reservation:extend" }, orderBy: { createdAt: "asc" }, select: { before: true, after: true } });
  const out: (StaySpan & { ratePaise: number })[] = [];
  for (const a of audits) {
    const before = a.before as { checkOutDate?: string } | null;
    const after = a.after as { checkOutDate?: string; ratePaise?: number; extensionSource?: string; paid?: { via?: string | null } } | null;
    if (!before?.checkOutDate || !after?.checkOutDate) continue;
    if (after.extensionSource) continue; // recorded by the app since 6 Nov
    const from = new Date(ymd(new Date(before.checkOutDate)) + "T00:00:00Z");
    const to = new Date(ymd(new Date(after.checkOutDate)) + "T00:00:00Z");
    if (to <= from) continue;
    const covered = [...r.extensions, ...out].some((e) => e.fromDate < to && e.toDate > from);
    if (covered) continue;
    const via = after.paid?.via?.trim().toLowerCase();
    out.push({ fromDate: from, toDate: to, source: (via && LABEL_TO_SOURCE[via]) || "DIRECT", ratePaise: after.ratePaise ?? r.ratePaise });
  }
  return out;
}

async function main() {
  const rs = await prisma.reservation.findMany({
    where: { ...(CODES.length ? { code: { in: CODES } } : {}), status: { in: ["IN_HOUSE", "CHECKED_OUT"] }, folio: { isNot: null } },
    select: SELECT,
    orderBy: { checkInDate: "asc" },
  });
  let extCount = 0, splitCount = 0, voids = 0, issues = 0;
  for (const r of rs) {
    const folio = r.folio!;
    const newExt = await plannedExtensions(r);
    const ctx: PartContext = { bookingSource: r.source, extensions: [...r.extensions, ...newExt] };
    const parts = billParts(folio.lines, folio.payments, ctx).filter((p) => p.lineIds.length > 0 && p.chargesPaise !== 0);
    const credited = new Set(folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
    const liveWhole = folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !credited.has(i.id) && i.billPart === null);
    const needsSplit = parts.length > 1 && liveWhole.length > 0;
    if (newExt.length === 0 && !needsSplit) continue;

    console.log(`\n${r.property.code} ${r.code} [${r.status}] ${r.guest.fullName} · ${r.source}`);
    for (const e of newExt) console.log(`  A  extension ${ymd(e.fromDate)}→${ymd(e.toDate)} → ${e.source}`);
    if (needsSplit) {
      for (const i of liveWhole) console.log(`  B  void ${i.number} ${inr(i.totalPaise)} (whole stay)`);
      for (const p of parts) console.log(`  B  new ${p.label} invoice ${inr(p.chargesPaise)}${p.guestBill ? " (guest's bill)" : " (hotel copy)"} · paid ${inr(p.paidPaise)} · balance ${inr(p.balancePaise)}`);
    }
    extCount += newExt.length; if (needsSplit) { splitCount++; voids += liveWhole.length; issues += parts.length; }
    if (!APPLY) continue;

    const assigned = assignParts(folio.lines, ctx);
    const reversed = new Set(folio.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    const fy = financialYearOf(new Date(), r.property.timezone);
    const orgId = r.property.orgId;
    await runWithSystemContext(orgId, async () => {
      await prisma.$transaction(async (tx) => {
        for (const e of newExt) {
          await tx.stayExtension.create({ data: { propertyId: r.propertyId, reservationId: r.id, fromDate: e.fromDate, toDate: e.toDate, source: e.source as never, ratePaise: e.ratePaise } });
        }
        if (newExt.length) {
          await writeAudit(tx, { action: "reservation:extension-source", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId, reason: "Past extensions recorded with their channel (client 10 Nov 2026: taken at the desk unless prepaid on an OTA) — script", after: { extensions: newExt.map((e) => ({ from: ymd(e.fromDate), to: ymd(e.toDate), source: e.source })) } });
        }
        if (!needsSplit) return;
        const bill = liveWhole[0]!; // name / GSTIN carried onto the new bills
        for (const original of liveWhole) {
          const cnNumber = await nextNumber(tx, orgId, original.financialYear);
          const cn = await tx.invoice.create({
            data: {
              propertyId: r.propertyId, folioId: folio.id, number: cnNumber, financialYear: original.financialYear, type: "CREDIT_NOTE", cancelsInvoiceId: original.id,
              customerName: original.customerName, customerGstin: original.customerGstin, placeOfSupply: original.placeOfSupply,
              taxableValuePaise: -original.taxableValuePaise, cgstPaise: -original.cgstPaise, sgstPaise: -original.sgstPaise, igstPaise: -original.igstPaise, totalPaise: -original.totalPaise,
            },
            select: { id: true },
          });
          if (original.lines.length) {
            await tx.invoiceLine.createMany({ data: original.lines.map((l, idx) => ({ invoiceId: cn.id, type: l.type, description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac, sortOrder: idx })) });
          }
          await writeAudit(tx, { action: "invoice:void", entityType: "Invoice", entityId: cn.id, propertyId: r.propertyId, reason: "split into separate OTA and direct bills (client 10 Nov 2026) — script", after: { number: cnNumber, cancels: original.number } });
          console.log(`     credit note ${cnNumber} cancels ${original.number}`);
        }
        for (const p of parts) {
          const lines = folio.lines.filter((l) => l.type !== "REVERSAL" && !reversed.has(l.id) && assigned.get(l.id) === p.part);
          let taxable = 0n, cgst = 0, sgst = 0, igst = 0, roundOff = 0n;
          for (const l of lines) {
            if (isRoundOff(l)) { roundOff += l.amountPaise; continue; }
            taxable += l.amountPaise; cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise;
          }
          const total = taxable + BigInt(cgst + sgst + igst) + roundOff;
          if (total === 0n) continue;
          const number = await nextNumber(tx, orgId, fy);
          const inv = await tx.invoice.create({
            data: {
              propertyId: r.propertyId, folioId: folio.id, number, financialYear: fy, type: "TAX_INVOICE", billPart: p.part,
              customerName: bill.customerName, customerGstin: bill.customerGstin, placeOfSupply: bill.placeOfSupply,
              taxableValuePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise: total, pdfObjectKey: null,
            },
            select: { id: true },
          });
          await tx.invoiceLine.createMany({ data: lines.map((l, idx) => ({ invoiceId: inv.id, type: String(l.type), description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: idx })) });
          await writeAudit(tx, { action: "invoice:generate", entityType: "Invoice", entityId: inv.id, propertyId: r.propertyId, reason: "split into separate OTA and direct bills — script", after: { number, totalPaise: Number(total), billPart: p.part } });
          console.log(`     ${p.label} invoice ${number} ${inr(total)}`);
        }
      }, { maxWait: 10_000, timeout: 60_000 });
    });
  }
  console.log(`\n=== ${extCount} extension(s) to record · ${splitCount} stay(s) to split: ${voids} credit note(s) + ${issues} new invoice(s) ===`);
  if (!APPLY) console.log("DRY RUN — nothing written. Re-run with CONFIRM=YES to apply.");
}

main().catch((e) => { console.error("FAILED:", e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
