/**
 * Shivang Dhand — BK-NHQMC7BO (HKD17 3F-1, 25→27 Oct) made to match the client's
 * real bill (physical invoice #828):
 *   name "Shavng Dhand" → "Shivang Dhand";
 *   2 nights @ ₹2,500 incl. GST (₹2,380.95 + 5%) = ₹5,000 (portal had ₹2,500 + GST = ₹5,250);
 *   paid UPI ₹3,000 on 29 Sep (advance) + UPI ₹2,000 on 26 Oct (portal had one bank transfer ₹5,250).
 *
 * Append-only + statutory-safe (same steps as fix-sunnana-merge.ts):
 *   credit note for WASPL:850 → room lines reversed and re-posted → the bank
 *   transfer refunded out and the two UPI receipts recorded with their real dates
 *   → ONE new tax invoice in the corrected name.
 *   npx tsx scripts/fix-shivang.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-shivang.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { postRoomChargeTx, nextRoomRevision, folioBalance, type BillingPostTx } from "../src/features/billing";
import { financialYearOf } from "../src/features/billing/domain/money";
import { formatInvoiceNumber } from "../src/features/billing/domain/invoice-number";
import { recomputeHistoricalSnapshot } from "../src/features/analytics/night-audit";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: bigint | number) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const CODE = "BK-NHQMC7BO";
const NAME = "Shivang Dhand";
const RATE = 238_095; // ₹2,380.95 pre-tax = ₹2,500 incl. 5% GST
const TARGET = 500_000n; // ₹5,000.00 — the bill's amount chargeable
const NIGHTS = [new Date("2026-10-25T00:00:00.000Z"), new Date("2026-10-26T00:00:00.000Z")];
const PAYMENTS = [
  { amountPaise: 300_000n, at: new Date("2026-09-29T12:00:00.000Z"), ref: "Advance (bill #828: UPI 29/09)" },
  { amountPaise: 200_000n, at: new Date("2026-10-26T12:00:00.000Z"), ref: "Balance (bill #828: UPI 26/10)" },
];
const WHY = "Corrected to the client's physical bill #828 — script";

const LINE_SEL = { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true } as const;
type Line = Prisma.FolioLineGetPayload<{ select: typeof LINE_SEL }>;
const sum = (ls: Line[]) => ls.reduce((s, l) => s + l.amountPaise + BigInt(l.cgstPaise + l.sgstPaise + l.igstPaise), 0n);
const active = (ls: Line[]) => { const rev = new Set(ls.filter((l) => l.reversalOfId).map((l) => l.reversalOfId)); return ls.filter((l) => l.type !== "REVERSAL" && !rev.has(l.id)); };
const isRoundOff = (l: { type: string; description: string }) => l.type === "MISC" && l.description === "Round off";

async function nextNumber(tx: Prisma.TransactionClient, orgId: string, fy: string): Promise<string> {
  await tx.companyInvoiceSeries.upsert({ where: { orgId_financialYear: { orgId, financialYear: fy } }, create: { orgId, financialYear: fy, prefix: "WASPL", nextNumber: 1 }, update: {} });
  const s = await tx.companyInvoiceSeries.update({ where: { orgId_financialYear: { orgId, financialYear: fy } }, data: { nextNumber: { increment: 1 } }, select: { prefix: true, nextNumber: true } });
  return formatInvoiceNumber({ prefix: s.prefix, financialYear: fy, nextNumber: s.nextNumber - 1 });
}

async function creditNote(tx: Prisma.TransactionClient, orgId: string, invoiceId: string): Promise<string> {
  const o = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { id: true, propertyId: true, folioId: true, financialYear: true, customerName: true, customerGstin: true, placeOfSupply: true, taxableValuePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, totalPaise: true, lines: { orderBy: { sortOrder: "asc" }, select: { type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true } } } });
  const number = await nextNumber(tx, orgId, o.financialYear);
  const cn = await tx.invoice.create({ data: {
    propertyId: o.propertyId, folioId: o.folioId, number, financialYear: o.financialYear, type: "CREDIT_NOTE", cancelsInvoiceId: o.id,
    customerName: o.customerName, customerGstin: o.customerGstin, placeOfSupply: o.placeOfSupply, taxableValuePaise: -o.taxableValuePaise,
    cgstPaise: -o.cgstPaise, sgstPaise: -o.sgstPaise, igstPaise: -o.igstPaise, totalPaise: -o.totalPaise,
  }, select: { id: true } });
  if (o.lines.length) await tx.invoiceLine.createMany({ data: o.lines.map((l, i) => ({ invoiceId: cn.id, type: l.type, description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac, sortOrder: i })) });
  await tx.domainEvent.create({ data: { orgId, propertyId: o.propertyId, type: "InvoiceIssued", aggregateId: cn.id, payload: { number, type: "CREDIT_NOTE", cancelsInvoiceId: o.id } } });
  await tx.auditLog.create({ data: { orgId, propertyId: o.propertyId, action: "invoice:void", entityType: "Invoice", entityId: cn.id, reason: WHY, after: { number, cancelsInvoiceId: o.id } } });
  return number;
}

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({ where: { code: CODE }, select: {
    id: true, propertyId: true, status: true, guestId: true, guest: { select: { fullName: true, gstNumber: true } },
    property: { select: { orgId: true, state: true, timezone: true } },
    folio: { select: { id: true, lines: { select: LINE_SEL }, payments: { select: { id: true, mode: true, amountPaise: true, isRefund: true, receivedAt: true } }, invoices: { select: { id: true, number: true, type: true, cancelsInvoiceId: true } } } },
  } });
  if (!r.folio) throw new Error("folio missing");
  if (r.guest.fullName === NAME) throw new Error("Already corrected — nothing to do.");
  const voided = new Set(r.folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
  const live = r.folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !voided.has(i.id));
  const pays = r.folio.payments.filter((p) => !p.isRefund);

  console.log(`NOW   ${r.guest.fullName} · bill ${inr(sum(r.folio.lines))} · paid ${pays.map((p) => `${p.mode} ${inr(p.amountPaise)}`).join(" + ")} · invoices ${live.map((i) => i.number).join(", ")}`);
  console.log(`PLAN  name → ${NAME}; credit note for ${live.map((i) => i.number).join(" + ")}; 2 nights @ ₹2,380.95 + GST = ${inr(TARGET)};`);
  console.log(`      refund-out ${pays.map((p) => `${p.mode} ${inr(p.amountPaise)}`).join(" + ")}; UPI ₹3,000 (29 Sep) + UPI ₹2,000 (26 Oct); new invoice in "${NAME}"`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  const orgId = r.property.orgId;
  const state = r.property.state;
  const fid = r.folio.id;
  let newNumber = "";
  await runWithSystemContext(orgId, async () => {
    await prisma.$transaction(async (tx) => {
      const T = tx as unknown as BillingPostTx;
      // 1. Name.
      await tx.guest.update({ where: { id: r.guestId }, data: { fullName: NAME } });
      await tx.auditLog.create({ data: { orgId, propertyId: r.propertyId, action: "guest:update", entityType: "Guest", entityId: r.guestId, reason: WHY, before: { fullName: r.guest.fullName }, after: { fullName: NAME } } });
      await tx.domainEvent.create({ data: { orgId, propertyId: r.propertyId, type: "GuestUpdated", aggregateId: r.guestId, payload: { guestId: r.guestId } } });

      // 2. Old invoice → credit note.
      for (const inv of live) await creditNote(tx, orgId, inv.id);

      // 3. Charges: reverse the active room lines, re-post both nights at the bill's rate.
      for (const l of active(await tx.folioLine.findMany({ where: { folioId: fid }, select: LINE_SEL }))) {
        await tx.folioLine.create({ data: {
          folioId: fid, type: "REVERSAL", description: `Reversal: ${l.description} (rate per physical bill #828)`, quantity: 1,
          unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
          cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
          hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState, businessDate: new Date(), reversalOfId: l.id,
        } });
      }
      for (const night of NIGHTS) {
        const ls = await tx.folioLine.findMany({ where: { folioId: fid }, select: LINE_SEL });
        await postRoomChargeTx(T, { folioId: fid, propertyId: r.propertyId, propertyState: state, ratePaise: RATE, businessDate: night, revision: nextRoomRevision(ls, night), postedById: null, description: "Room 3F-1 · night" });
      }
      const adj = TARGET - sum(await tx.folioLine.findMany({ where: { folioId: fid }, select: LINE_SEL }));
      if (adj > 100n || adj < -100n) throw new Error(`round-off ${adj} too large`);
      if (adj !== 0n) await tx.folioLine.create({ data: { folioId: fid, type: "MISC", description: "Round off", quantity: 1, unitPaise: Number(adj), amountPaise: adj, taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, hsnSac: null, placeOfSupplyState: state, businessDate: new Date() } });
      await tx.reservation.update({ where: { id: r.id }, data: { ratePaise: RATE } });

      // 4. Payments: the recorded bank transfer is refunded out; the bill's two UPI receipts recorded on their dates.
      for (const p of pays) {
        await tx.payment.create({ data: { propertyId: r.propertyId, folioId: fid, mode: p.mode, amountPaise: p.amountPaise, isRefund: true, reference: "Entered in error — guest paid by UPI (bill #828)", receivedAt: p.receivedAt } });
      }
      for (const p of PAYMENTS) {
        const pay = await tx.payment.create({ data: { propertyId: r.propertyId, folioId: fid, mode: "UPI", amountPaise: p.amountPaise, reference: p.ref, receivedAt: p.at }, select: { id: true } });
        await tx.domainEvent.create({ data: { orgId, propertyId: r.propertyId, type: "PaymentReceived", aggregateId: fid, payload: { paymentId: pay.id, tenders: [{ mode: "UPI", amountPaise: Number(p.amountPaise) }] } } });
      }

      // 5. One new tax invoice in the corrected name (same rules as generateInvoice).
      const act = active(await tx.folioLine.findMany({ where: { folioId: fid }, select: LINE_SEL, orderBy: { createdAt: "asc" } }));
      let taxable = 0n, cgst = 0, sgst = 0, igst = 0, roundOff = 0n;
      for (const l of act) { if (isRoundOff(l)) { roundOff += l.amountPaise; continue; } taxable += l.amountPaise; cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise; }
      const totalPaise = taxable + BigInt(cgst + sgst + igst) + roundOff;
      if (totalPaise !== TARGET) throw new Error(`invoice total ${totalPaise} ≠ ${TARGET}`);
      const fy = financialYearOf(new Date(), r.property.timezone);
      newNumber = await nextNumber(tx, orgId, fy);
      const inv = await tx.invoice.create({ data: {
        propertyId: r.propertyId, folioId: fid, number: newNumber, financialYear: fy, type: "TAX_INVOICE",
        customerName: NAME, customerGstin: r.guest.gstNumber ?? null, placeOfSupply: state,
        taxableValuePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise, pdfObjectKey: null,
      }, select: { id: true } });
      await tx.invoiceLine.createMany({ data: act.map((l, i) => ({ invoiceId: inv.id, type: String(l.type), description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: i })) });
      await tx.domainEvent.create({ data: { orgId, propertyId: r.propertyId, type: "InvoiceIssued", aggregateId: inv.id, payload: { number: newNumber, totalPaise: Number(totalPaise), type: "TAX_INVOICE" } } });
      await tx.auditLog.create({ data: { orgId, propertyId: r.propertyId, action: "invoice:generate", entityType: "Invoice", entityId: inv.id, reason: WHY, after: { number: newNumber, totalPaise: Number(totalPaise) } } });
    }, { maxWait: 15_000, timeout: 60_000 });
    for (const n of NIGHTS) { try { await recomputeHistoricalSnapshot(r.propertyId, n); } catch { /* non-fatal */ } }
  });

  const x = await prisma.reservation.findFirstOrThrow({ where: { code: CODE }, select: { guest: { select: { fullName: true } }, folio: { select: { lines: { select: LINE_SEL }, payments: { select: { mode: true, amountPaise: true, isRefund: true, receivedAt: true } }, invoices: { select: { number: true, type: true, totalPaise: true, customerName: true } } } } } });
  console.log(`✅ ${CODE} · ${x.guest.fullName} · bill ${inr(sum(x.folio!.lines))} · balance ${inr(folioBalance(x.folio!.lines, x.folio!.payments))}`);
  console.log(`   payments: ${x.folio!.payments.map((p) => `${p.isRefund ? "refund " : ""}${p.mode} ${inr(p.amountPaise)} ${p.receivedAt.toISOString().slice(0, 10)}`).join(" · ")}`);
  console.log(`   invoices: ${x.folio!.invoices.map((i) => `${i.number} ${i.type} ${inr(i.totalPaise)} (${i.customerName})`).join(" · ")}`);
  console.log(`New invoice: ${newNumber}`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
