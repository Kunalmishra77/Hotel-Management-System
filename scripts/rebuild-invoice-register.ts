/**
 * PHASE B — one clean invoice register before go-live (client/CA, 29 Oct 2026).
 *
 * The paper invoices WASPL:803–836 are real; the portal had issued its own
 * numbers in parallel, so the same numbers belong to different guests. This:
 *   1. removes the invoices that are of no use: every credit note, every voided
 *      invoice, and every old invoice on the 34 paper-bill stays (and the bookings
 *      merged into them);
 *   2. issues each paper-bill stay's invoice with its PAPER number and date, from
 *      the (phase-A corrected) folio — totals must equal the paper bill;
 *   3. renumbers the remaining portal invoices around the paper block, in issue
 *      order: those issued before 19 Oct end at 802; the rest follow 836;
 *   4. sets the company series so the first invoice after go-live is the next number.
 *
 * Deleting / renumbering an invoice needs the `invoice_immutable` trigger off for
 * this one transaction — the dry-run never touches it. Backup:
 * scratchpad/backup-before-paper-2026-10-29.json.
 *   npx tsx scripts/rebuild-invoice-register.ts                      (dry-run: the full numbering plan)
 *   $env:CONFIRM="YES"; npx tsx scripts/rebuild-invoice-register.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { formatInvoiceNumber } from "../src/features/billing/domain/invoice-number";
import { PAPER_BILLS } from "./paper-bills";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const FY = "2026-27";
const PREFIX = "WASPL";
const FIRST_PAPER = 803;
const LAST_PAPER = 836;
const PAPER_FROM = new Date("2026-10-18T18:30:00.000Z"); // 19 Oct 00:00 IST — the first paper bill's date
const num = (n: number) => formatInvoiceNumber({ prefix: PREFIX, financialYear: FY, nextNumber: n });
const inr = (p: bigint | number) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const OFF_INVOICE = "(collected separately";

async function main() {
  const codes = new Set<string>();
  for (const b of PAPER_BILLS) [b.code, ...(b.merge ?? []), ...(b.emptyOnly ?? []), ...(b.side ? [b.side.code] : [])].forEach((c) => codes.add(c));
  const paperFolios = await prisma.folio.findMany({ where: { reservation: { code: { in: [...codes] } } }, select: { id: true, reservation: { select: { code: true } } } });
  const paperFolioIds = new Set(paperFolios.map((f) => f.id));

  const all = await prisma.invoice.findMany({
    select: { id: true, number: true, type: true, cancelsInvoiceId: true, folioId: true, issuedAt: true, totalPaise: true, customerName: true, propertyId: true, financialYear: true },
    orderBy: [{ issuedAt: "asc" }, { number: "asc" }],
  });
  const voided = new Set(all.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
  const remove = all.filter((i) => i.type === "CREDIT_NOTE" || voided.has(i.id) || paperFolioIds.has(i.folioId));
  const keep = all.filter((i) => !remove.includes(i));
  const before = keep.filter((i) => i.issuedAt < PAPER_FROM);
  const after = keep.filter((i) => i.issuedAt >= PAPER_FROM);
  const startBefore = FIRST_PAPER - before.length;
  const renumber = [
    ...before.map((i, k) => ({ inv: i, to: num(startBefore + k) })),
    ...after.map((i, k) => ({ inv: i, to: num(LAST_PAPER + 1 + k) })),
  ];
  const nextNumber = LAST_PAPER + 1 + after.length;

  // Paper invoices, built from the corrected folios.
  const plans = await Promise.all(PAPER_BILLS.map(async (b) => {
    const r = await prisma.reservation.findFirstOrThrow({ where: { code: b.code }, select: {
      propertyId: true, guest: { select: { fullName: true } }, property: { select: { state: true } },
      folio: { select: { id: true, lines: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, reversalOfId: true } } } },
    } });
    if (!r.folio) throw new Error(`#${b.inv} ${b.code}: no folio`);
    const rev = new Set(r.folio.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
    const lines = r.folio.lines.filter((l) => l.type !== "REVERSAL" && !rev.has(l.id) && !l.description.includes(OFF_INVOICE));
    let taxable = 0n, cgst = 0, sgst = 0, igst = 0, roundOff = 0n;
    for (const l of lines) {
      if (l.type === "MISC" && l.description === "Round off") { roundOff += l.amountPaise; continue; }
      taxable += l.amountPaise; cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise;
    }
    const total = taxable + BigInt(cgst + sgst + igst) + roundOff;
    if (total !== BigInt(Math.round(b.total * 100))) throw new Error(`#${b.inv} ${b.code}: folio gives ${inr(total)}, paper says ₹${b.total} — run phase A first`);
    return { b, r, lines, taxable, cgst, sgst, igst, total, customerName: b.customerName ?? r.guest.fullName };
  }));

  console.log(`Register now: ${all.length} invoices (${all.filter((i) => i.type === "CREDIT_NOTE").length} credit notes, ${voided.size} voided).`);
  console.log(`\n1. REMOVE ${remove.length}: ${remove.filter((i) => i.type === "CREDIT_NOTE").length} credit notes, ${remove.filter((i) => voided.has(i.id)).length} voided, ${remove.filter((i) => i.type !== "CREDIT_NOTE" && !voided.has(i.id)).length} old live invoices on the paper-bill stays`);
  console.log(`\n2. ISSUE ${plans.length} paper invoices WASPL:${FIRST_PAPER}–${LAST_PAPER}:`);
  for (const p of plans) console.log(`   ${num(p.b.inv)}  ${p.b.dated}  ${p.customerName}${p.b.gstin ? ` (GSTIN ${p.b.gstin})` : ""}  ${inr(p.total)}`);
  console.log(`\n3. RENUMBER ${renumber.length} other invoices (issue order kept):`);
  console.log(`   before 19 Oct (${before.length}) → WASPL:${startBefore}–${FIRST_PAPER - 1}`);
  console.log(`   from 19 Oct   (${after.length}) → WASPL:${LAST_PAPER + 1}–${nextNumber - 1}`);
  for (const x of renumber) if (x.inv.number !== x.to) console.log(`   ${x.inv.number.padEnd(17)} → ${x.to.padEnd(17)} ${x.inv.issuedAt.toISOString().slice(0, 10)} ${x.inv.customerName} ${inr(x.inv.totalPaise)}`);
  console.log(`   (${renumber.filter((x) => x.inv.number === x.to).length} keep their number)`);
  console.log(`\n4. SERIES: next invoice after go-live = ${num(nextNumber)}`);
  console.log(`\nResult: ${keep.length + plans.length} invoices, WASPL:${startBefore}–${nextNumber - 1}, no gaps, no duplicates.`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  const orgId = (await prisma.property.findFirstOrThrow({ select: { orgId: true } })).orgId;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "Invoice" DISABLE TRIGGER invoice_immutable`);
    const ids = remove.map((i) => i.id);
    await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: ids } } });
    await tx.invoice.deleteMany({ where: { id: { in: ids } } });
    // Two passes so no number is ever held twice mid-way (unique per property).
    for (const x of renumber) await tx.invoice.update({ where: { id: x.inv.id }, data: { number: `TMP-${x.inv.id}` } });
    for (const x of renumber) await tx.invoice.update({ where: { id: x.inv.id }, data: { number: x.to, pdfObjectKey: null } });
    for (const p of plans) {
      const inv = await tx.invoice.create({ data: {
        propertyId: p.r.propertyId, folioId: p.r.folio!.id, number: num(p.b.inv), financialYear: FY, type: "TAX_INVOICE",
        customerName: p.customerName, customerGstin: p.b.gstin ?? null, placeOfSupply: p.r.property.state,
        taxableValuePaise: p.taxable, cgstPaise: p.cgst, sgstPaise: p.sgst, igstPaise: p.igst, totalPaise: p.total,
        issuedAt: new Date(`${p.b.dated}T06:30:00.000Z`), pdfObjectKey: null,
      }, select: { id: true } });
      await tx.invoiceLine.createMany({ data: p.lines.map((l, i) => ({ invoiceId: inv.id, type: String(l.type), description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: i })) });
    }
    await tx.companyInvoiceSeries.update({ where: { orgId_financialYear: { orgId, financialYear: FY } }, data: { nextNumber } });
    await tx.$executeRawUnsafe(`ALTER TABLE "Invoice" ENABLE TRIGGER invoice_immutable`);
    await tx.auditLog.create({ data: { orgId, action: "invoice:register-rebuild", entityType: "CompanyInvoiceSeries", entityId: `${orgId}:${FY}`,
      reason: "Pre-go-live register rebuild (client/CA, 29 Oct 2026): paper invoices 803–836 issued with their real numbers; credit notes / voided / superseded demo invoices removed; others renumbered around the paper block — backup taken — script",
      after: { removed: remove.length, paperIssued: plans.length, renumbered: renumber.length, nextNumber } } });
  }, { maxWait: 20_000, timeout: 300_000 });
  console.log(`\n✅ Register rebuilt. Next invoice: ${num(nextNumber)}`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
