/**
 * Tarun Baajwan BK-Q4O5RL12 (client, 23 Nov 2026). 21→22 Nov was MakeMyTrip
 * (₹2,390 incl. GST, paid online), extended 22→23 Nov Direct at ₹2,205 incl. GST
 * (paid UPI). Staff flipped the booking source to DIRECT to extend, and a whole-stay
 * rate edit billed BOTH nights at ₹2,390 → one Direct bill 1089 ₹4,780.03 and a
 * ₹185 phantom due. Using the app's own actions:
 *   1. booking source back to MAKEMYTRIP (the extension stays DIRECT);
 *   2. re-price only the night of 22 Nov to ₹2,205 incl. GST;
 *   3. reverse the ₹-0.03 "Round off" (both bills now match their payments exactly);
 *   4. Correct bill 1089 → the Direct bill (same number), and issue the MMT copy.
 *
 *   npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/fix-tarun-mmt-split.ts            (dry run)
 *   CONFIRM=YES npx tsx --require ./scripts/lib/as-user-hook.cjs scripts/fix-tarun-mmt-split.ts
 */
import { PrismaClient } from "@prisma/client";
import { assembleClaims } from "../src/lib/auth/claims";
import { changeBookingSource, setRoomRate } from "../src/features/reservations/move-actions";
import { reverseFolioLine } from "../src/features/billing/charge-actions";
import { reviseInvoice } from "../src/features/billing/invoice-revise-actions";
import { generateInvoice } from "../src/features/billing/invoice-actions";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient();
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toFixed(2)}`;

async function show(folioId: string) {
  const f = await prisma.folio.findUniqueOrThrow({
    where: { id: folioId },
    select: { lines: { select: { id: true, type: true, description: true, businessDate: true, amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true, reversalOfId: true } }, payments: { select: { amountPaise: true, isRefund: true, mode: true } }, invoices: { where: { supersededById: null }, select: { number: true, billPart: true, totalPaise: true, type: true } } },
  });
  const reversed = new Set(f.lines.map((l) => l.reversalOfId).filter(Boolean));
  let bal = 0;
  for (const l of f.lines) {
    const g = Number(l.amountPaise) + l.cgstPaise + l.sgstPaise + l.igstPaise;
    bal += g;
    if (l.type !== "REVERSAL" && !reversed.has(l.id)) console.log(`  active ${l.type} ${l.businessDate.toISOString().slice(0, 10)} ${inr(g)} ${l.description}`);
  }
  for (const p of f.payments) bal -= (p.isRefund ? -1 : 1) * Number(p.amountPaise);
  for (const i of f.invoices) console.log(`  bill ${i.number} [${i.billPart}] ${i.type} ${inr(i.totalPaise)}`);
  console.log(`  balance ${inr(bal)}`);
  return f;
}

async function main() {
  const owner = await prisma.user.findFirstOrThrow({ where: { email: "woodpecker.sunil@gmail.com" }, select: { id: true } });
  const claims = await assembleClaims(prisma, owner.id);
  if (!claims) throw new Error("owner has no claims");
  (globalThis as { __SCRIPT_CLAIMS?: unknown }).__SCRIPT_CLAIMS = { ...claims, activePropertyId: null };

  const r = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-Q4O5RL12" }, select: { id: true, source: true, folio: { select: { id: true } } } });
  const folioId = r.folio!.id;
  console.log(`before (source ${r.source}):`);
  const f = await show(folioId);
  if (!APPLY) { console.log("DRY RUN — re-run with CONFIRM=YES"); return; }

  const must = <T>(res: { ok: true; data: T } | { ok: false; error: { message: string } }, step: string): T => {
    if (!res.ok) throw new Error(`${step}: ${res.error.message}`);
    return res.data;
  };
  must(await changeBookingSource({ reservationId: r.id, source: "MAKEMYTRIP", bookedOn: "2026-11-21" }), "source");
  must(await setRoomRate({ reservationId: r.id, newRatePaise: 220_500, gstMode: "inclusive", fromNight: "2026-11-22", toNight: "2026-11-23" }), "rate");
  const reversed = new Set(f.lines.map((l) => l.reversalOfId).filter(Boolean));
  const roundOff = f.lines.find((l) => l.type === "MISC" && l.description === "Round off" && !reversed.has(l.id));
  if (roundOff) must(await reverseFolioLine({ lineId: roundOff.id, reason: "MMT and Direct bills each match their payment exactly" }), "round off");

  const direct = await prisma.invoice.findFirstOrThrow({ where: { folioId, type: "TAX_INVOICE", supersededById: null, billPart: "DIRECT" }, select: { id: true, customerName: true } });
  const rev = must(await reviseInvoice({ invoiceId: direct.id, customerName: direct.customerName, reason: "21→22 Nov was MakeMyTrip; only the 22→23 Nov extension (₹2,205 incl. GST) is the Direct bill" }), "revise");
  console.log(`corrected: ${rev.number} rev ${rev.revision} ${inr(rev.totalPaise)}`);
  const mmt = must(await generateInvoice({ folioId, customerName: direct.customerName, billPart: "MAKEMYTRIP" }), "mmt bill");
  console.log(`MMT bill: ${mmt.number} ${inr(mmt.totalPaise)}`);
  console.log("after:");
  await show(folioId);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
