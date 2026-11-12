/**
 * Vijay Kumar, BK-QQWQ4HDC — the MakeMyTrip night (27 Oct, ₹1,937 incl. GST) was
 * prepaid through MakeMyTrip, but that money was never recorded, so the MMT bill
 * (invoice WASPL 1016) showed ₹1,937 due. Record it as "Online / OTA prepaid"
 * dated 27 Oct (client confirmed 12 Nov 2026: fully paid). Payment only — no
 * charge or invoice changes.
 *   npx tsx scripts/fix-vijay-mmt-payment.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-vijay-mmt-payment.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { billParts, folioBalance, postPaymentTx, type BillingPostTx } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const AMOUNT = 193_700;

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-QQWQ4HDC" },
    select: { id: true, propertyId: true, source: true, property: { select: { orgId: true } }, extensions: { select: { fromDate: true, toDate: true, source: true } }, folio: { select: { id: true, lines: true, payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } } } } },
  });
  const folio = r.folio!;
  const ctx = { bookingSource: r.source, extensions: r.extensions };
  const show = (lines: typeof folio.lines, pays: typeof folio.payments) => billParts(lines, pays, ctx).map((p) => `${p.label} ${inr(p.chargesPaise)} paid ${inr(p.paidPaise)} due ${inr(p.balancePaise)}`).join(" · ");
  const balance = folioBalance(folio.lines, folio.payments);
  console.log(`now: ${show(folio.lines, folio.payments)} · folio balance ${inr(balance)}`);
  if (Number(balance) !== AMOUNT) throw new Error(`balance is ${inr(balance)}, expected ₹1,937 — changed since?`);
  if (folio.payments.some((p) => p.mode === "ONLINE")) throw new Error("an online payment is already recorded");
  if (!APPLY) { console.log("DRY RUN — will record ₹1,937.00 ONLINE (MakeMyTrip prepaid), dated 27 Oct. Re-run with CONFIRM=YES."); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      const id = await postPaymentTx(tx as unknown as BillingPostTx, { folioId: folio.id, propertyId: r.propertyId, mode: "ONLINE", amountPaise: AMOUNT, reference: "MakeMyTrip prepaid — 27 Oct night (recorded 12 Nov)", receivedById: null, receivedAt: new Date("2026-10-27T06:30:00Z") });
      await writeAudit(tx, { action: "folio:payment", entityType: "Payment", entityId: id, propertyId: r.propertyId, reason: "MakeMyTrip prepayment never recorded; client confirmed fully paid — script", after: { amountPaise: AMOUNT, mode: "ONLINE" } });
    });
  });
  const after = await prisma.folio.findUniqueOrThrow({ where: { id: folio.id }, select: { lines: true, payments: { select: { mode: true, reference: true, amountPaise: true, isRefund: true } } } });
  console.log(`✅ after: ${show(after.lines, after.payments)} · folio balance ${inr(folioBalance(after.lines, after.payments))}`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
