/**
 * Vijay Kumar, BK-QQWQ4HDC (HKD17) — 27→29 Oct. Night 1 (27 Oct) was booked on
 * MakeMyTrip at ₹1,937 incl. GST; night 2 (28 Oct) was a direct extension at
 * ₹2,499.99 incl. GST (unchanged). He paid ₹2,500 by UPI at the hotel. Two bills,
 * two GST invoices (client, 12 Nov 2026). His old whole-stay invoice 849 is
 * already voided (credit note 1012). Append-only:
 *  - booking source → MAKEMYTRIP; 28→29 Oct recorded as a DIRECT extension;
 *  - 27 Oct re-priced to ₹1,844.76 + 5% GST = ₹1,937.00;
 *  - round-off re-done so the direct bill is a whole ₹2,500.00 (= the UPI paid);
 *  - one invoice per bill (MakeMyTrip ₹1,937 hotel copy · Direct ₹2,500 guest's).
 *   npx tsx scripts/fix-vijay-mmt-direct.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-vijay-mmt-direct.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { activeLines, assignParts, billParts, folioBalance, nextRoomRevision, postRoomChargesTx, roomChargeLineData, type BillingBulkTx, type PartContext } from "../src/features/billing";
import { formatInvoiceNumber } from "../src/features/billing/domain/invoice-number";
import { financialYearOf } from "../src/features/billing/domain/money";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const N1 = new Date("2026-10-27T00:00:00Z");
const N2 = new Date("2026-10-28T00:00:00Z");
const N3 = new Date("2026-10-29T00:00:00Z");
const MMT_RATE = 184_476; // + 5% GST (₹46.12 + ₹46.12) = ₹1,937.00
const isRoundOff = (l: { type: string; description: string }) => l.type === "MISC" && l.description === "Round off";

async function nextNumber(tx: Prisma.TransactionClient, orgId: string, fy: string): Promise<string> {
  await tx.companyInvoiceSeries.upsert({ where: { orgId_financialYear: { orgId, financialYear: fy } }, create: { orgId, financialYear: fy, prefix: "WASPL", nextNumber: 1 }, update: {} });
  const s = await tx.companyInvoiceSeries.update({ where: { orgId_financialYear: { orgId, financialYear: fy } }, data: { nextNumber: { increment: 1 } }, select: { prefix: true, nextNumber: true } });
  return formatInvoiceNumber({ prefix: s.prefix, financialYear: fy, nextNumber: s.nextNumber - 1 });
}

const SELECT = {
  id: true, code: true, status: true, source: true, propertyId: true, ratePaise: true,
  guest: { select: { fullName: true, gstNumber: true } },
  property: { select: { orgId: true, state: true, timezone: true } },
  extensions: { select: { fromDate: true, toDate: true, source: true } },
  folio: { select: { id: true, lines: true, payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } }, invoices: { select: { id: true, number: true, type: true, cancelsInvoiceId: true } } } },
} as const;

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-QQWQ4HDC" }, select: SELECT });
  if (!r.guest.fullName.toLowerCase().includes("vijay")) throw new Error("unexpected guest");
  const folio = r.folio!;
  const credited = new Set(folio.invoices.filter((i) => i.cancelsInvoiceId).map((i) => i.cancelsInvoiceId));
  const live = folio.invoices.filter((i) => i.type === "TAX_INVOICE" && !credited.has(i.id));
  if (live.length) throw new Error(`live invoice(s) ${live.map((i) => i.number).join(", ")} — void them first`);
  const act = activeLines(folio.lines);
  const night1 = act.find((l) => l.type === "ROOM" && l.businessDate.getTime() === N1.getTime());
  const night2 = act.find((l) => l.type === "ROOM" && l.businessDate.getTime() === N2.getTime());
  const roundOffs = act.filter(isRoundOff);
  if (!night1 || !night2) throw new Error("expected active nights on 27 and 28 Oct");
  if (r.source === "MAKEMYTRIP") throw new Error("source already MAKEMYTRIP — already fixed?");

  const n1 = roomChargeLineData({ folioId: "x", propertyId: r.propertyId, propertyState: r.property.state, ratePaise: MMT_RATE, businessDate: N1 });
  const n1Gross = Number(n1.amountPaise) + n1.cgstPaise! + n1.sgstPaise! + n1.igstPaise!;
  if (n1Gross !== 193_700) throw new Error(`maths gives ${inr(n1Gross)}`);
  const n2Gross = Number(night2.amountPaise) + night2.cgstPaise + night2.sgstPaise + night2.igstPaise;
  const total = n1Gross + n2Gross;
  const newRoundOff = Math.round(total / 100) * 100 - total; // whole rupee
  console.log(`${r.guest.fullName} · ${r.status} · ${r.source} · balance ${inr(folioBalance(folio.lines, folio.payments))}`);
  console.log(`  27 Oct: ${inr(Number(night1.amountPaise) + night1.cgstPaise + night1.sgstPaise)} → ${inr(n1Gross)} (MakeMyTrip) · 28 Oct: ${inr(n2Gross)} (Direct, unchanged)`);
  console.log(`  round-off ${roundOffs.map((l) => inr(l.amountPaise)).join(", ") || "none"} → ${inr(newRoundOff)} · total ${inr(total + newRoundOff)}`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  const orgId = r.property.orgId;
  await runWithSystemContext(orgId, async () => {
    await prisma.$transaction(async (tx) => {
      // 1 · channel: MMT booking, 28 Oct extension direct
      await tx.reservation.update({ where: { id: r.id }, data: { source: "MAKEMYTRIP" } });
      await tx.stayExtension.create({ data: { propertyId: r.propertyId, reservationId: r.id, fromDate: N2, toDate: N3, source: "DIRECT", ratePaise: night2.unitPaise } });
      // 2 · re-price 27 Oct; re-do the round-off
      await tx.folioLine.createMany({
        data: [night1, ...roundOffs].map((l) => ({
          folioId: folio.id, type: "REVERSAL" as const, description: `Reversal: ${l.description} (27 Oct was the MakeMyTrip night at ₹1,937 incl. GST)`,
          quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
          cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
          businessDate: l.businessDate, reversalOfId: l.id, postedById: null,
        })),
      });
      await postRoomChargesTx(tx as unknown as BillingBulkTx, [{ folioId: folio.id, propertyId: r.propertyId, propertyState: r.property.state, ratePaise: MMT_RATE, businessDate: N1, revision: nextRoomRevision(folio.lines, N1), postedById: null, description: "Room charge · night (MakeMyTrip)" }]);
      if (newRoundOff !== 0) {
        await tx.folioLine.create({ data: { folioId: folio.id, type: "MISC", description: "Round off", quantity: 1, unitPaise: newRoundOff, amountPaise: BigInt(newRoundOff), taxRateBps: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, hsnSac: "996311", placeOfSupplyState: r.property.state, businessDate: N3, postedById: null } });
      }
      await tx.domainEvent.create({ data: { orgId, propertyId: r.propertyId, type: "ReservationModified", aggregateId: r.id, payload: { source: "MAKEMYTRIP", reason: "mmt-night-and-direct-extension" } } });
      await writeAudit(tx, {
        action: "reservation:stay-correct", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
        reason: "27 Oct booked on MakeMyTrip at ₹1,937 incl. GST; 28 Oct a direct extension — two bills (client 12 Nov) — script",
        before: { source: r.source }, after: { source: "MAKEMYTRIP", extension: "2026-10-28→2026-10-29 DIRECT", night1GrossPaise: 193_700 },
      });

      // 3 · one invoice per bill, from the corrected folio
      const fresh = await tx.folio.findUniqueOrThrow({ where: { id: folio.id }, select: { lines: true, payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } } } });
      const ctx: PartContext = { bookingSource: "MAKEMYTRIP", extensions: [...r.extensions, { fromDate: N2, toDate: N3, source: "DIRECT" }] };
      const assigned = assignParts(fresh.lines, ctx);
      const reversed = new Set(fresh.lines.filter((l) => l.reversalOfId).map((l) => l.reversalOfId));
      const fy = financialYearOf(new Date(), r.property.timezone);
      for (const p of billParts(fresh.lines, fresh.payments, ctx).filter((b) => b.lineIds.length && b.chargesPaise !== 0)) {
        const lines = fresh.lines.filter((l) => l.type !== "REVERSAL" && !reversed.has(l.id) && assigned.get(l.id) === p.part);
        let taxable = 0n, cgst = 0, sgst = 0, igst = 0, ro = 0n;
        for (const l of lines) { if (isRoundOff(l)) { ro += l.amountPaise; continue; } taxable += l.amountPaise; cgst += l.cgstPaise; sgst += l.sgstPaise; igst += l.igstPaise; }
        const totalPaise = taxable + BigInt(cgst + sgst + igst) + ro;
        const number = await nextNumber(tx, orgId, fy);
        const inv = await tx.invoice.create({ data: { propertyId: r.propertyId, folioId: folio.id, number, financialYear: fy, type: "TAX_INVOICE", billPart: p.part, customerName: r.guest.fullName, customerGstin: r.guest.gstNumber ?? null, placeOfSupply: r.property.state, taxableValuePaise: taxable, cgstPaise: cgst, sgstPaise: sgst, igstPaise: igst, totalPaise, pdfObjectKey: null }, select: { id: true } });
        await tx.invoiceLine.createMany({ data: lines.map((l, idx) => ({ invoiceId: inv.id, type: String(l.type), description: l.description, quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps, cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise, hsnSac: l.hsnSac, sortOrder: idx })) });
        await writeAudit(tx, { action: "invoice:generate", entityType: "Invoice", entityId: inv.id, propertyId: r.propertyId, reason: "separate MakeMyTrip and direct bills — script", after: { number, totalPaise: Number(totalPaise), billPart: p.part } });
        console.log(`  ${p.label} invoice ${number} ${inr(totalPaise)} · paid ${inr(p.paidPaise)} · balance ${inr(p.balancePaise)}`);
      }
    }, { maxWait: 10_000, timeout: 60_000 });
  });
  console.log("✅ Done. Restate HKD17 27–28 Oct stats next.");
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
