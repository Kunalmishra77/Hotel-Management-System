/**
 * Record the ₹2,625 advance the guest paid for Tushita Agnihotri (BK-UV5RNJFZ)
 * that was never entered — the folio has only the ₹7,875 checkout payment, so it
 * shows ₹2,625 due. Recording the advance brings the balance to ₹0.
 *
 *   npx tsx scripts/record-tushita-advance.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/record-tushita-advance.ts  (apply, mode CASH)
 *   $env:MODE="UPI"; $env:CONFIRM="YES"; npx tsx scripts/record-tushita-advance.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { postPaymentTx, folioBalance, type BillingPostTx } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const MODE = (process.env.MODE || "CASH") as never;
const AMOUNT_PAISE = 262_500; // ₹2,625
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

async function bal(folioId: string) {
  const f = await prisma.folio.findUniqueOrThrow({ where: { id: folioId }, select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } });
  return folioBalance(f.lines, f.payments);
}

async function main() {
  const r = await prisma.reservation.findFirst({ where: { code: "BK-UV5RNJFZ" }, select: { id: true, propertyId: true, folio: { select: { id: true } }, property: { select: { orgId: true } } } });
  if (!r?.folio) throw new Error("folio not found");
  const existing = await prisma.payment.findFirst({ where: { folioId: r.folio.id, reference: "ADVANCE-RECONCILE" }, select: { id: true } });
  console.log("Balance before:", inr(await bal(r.folio.id)));
  if (existing) { console.log("Advance already recorded (ADVANCE-RECONCILE). Nothing to do."); return; }
  console.log(`Will record a ${inr(AMOUNT_PAISE)} ${MODE} payment (the guest's advance).`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES (and MODE=UPI if it was UPI)."); return; }
  await runWithSystemContext(r.property.orgId, () =>
    prisma.$transaction(async (tx) => {
      await postPaymentTx(tx as unknown as BillingPostTx, { folioId: r.folio!.id, propertyId: r.propertyId, mode: MODE, amountPaise: AMOUNT_PAISE, reference: "ADVANCE-RECONCILE", receivedById: null });
    }),
  );
  console.log("Balance after: ", inr(await bal(r.folio.id)));
}

main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
