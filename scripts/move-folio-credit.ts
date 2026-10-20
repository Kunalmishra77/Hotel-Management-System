/**
 * Move a credit from one leg of a split stay onto another, for a stay that is
 * already in progress and cannot wait for the UI to ship.
 *
 * Mirrors `moveFolioCredit` exactly — same guards (same guest, linked journey,
 * source actually in credit, amount within it) and the same two payment rows. It
 * reallocates money ALREADY received and posts no charge, so revenue, GST and
 * invoices are untouched and the journey's cash total does not move.
 *
 *   $env:FROM="BK-AAA"; $env:TO="BK-BBB"; npx tsx scripts/move-folio-credit.ts
 *   add $env:CONFIRM="YES" to apply
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { folioBalance } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const FROM = process.env.FROM;
const TO = process.env.TO;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const LOAD = {
  id: true, code: true, guestId: true, transferredFromId: true, propertyId: true,
  property: { select: { orgId: true, name: true } },
  folio: {
    select: {
      id: true,
      lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } },
      payments: { select: { amountPaise: true, isRefund: true } },
    },
  },
} as const;

async function main() {
  if (!FROM || !TO) throw new Error("Set FROM and TO to the two booking codes.");
  const from = await prisma.reservation.findFirstOrThrow({ where: { code: FROM }, select: LOAD });
  const to = await prisma.reservation.findFirstOrThrow({ where: { code: TO }, select: LOAD });
  if (!from.folio || !to.folio) throw new Error("Both bookings need a folio.");
  if (from.guestId !== to.guestId) throw new Error("Those bookings belong to different guests.");

  const linked = to.transferredFromId === from.id || from.transferredFromId === to.id;
  if (!linked) throw new Error("Those bookings are not linked legs of one stay.");

  const fromBal = folioBalance(from.folio.lines, from.folio.payments);
  const toBal = folioBalance(to.folio.lines, to.folio.payments);
  const credit = -fromBal;
  if (credit <= 0n) throw new Error(`${from.code} has no credit (balance ${inr(fromBal)}).`);
  // AMOUNT (rupees) moves only part of the credit — the rest stays where it is,
  // which is what you want when the surplus is a genuine refund owed to the guest
  // rather than money that belongs on the other leg.
  const want = process.env.AMOUNT ? BigInt(Math.round(Number(process.env.AMOUNT) * 100)) : credit;
  if (want > credit) throw new Error(`AMOUNT ${inr(want)} exceeds the ${inr(credit)} credit.`);

  console.log(`${from.code} @ ${from.property.name}  balance ${inr(fromBal)}  → credit ${inr(credit)}`);
  console.log(`${to.code} @ ${to.property.name}  balance ${inr(toBal)}`);
  console.log(`\nmove ${inr(credit)}:`);
  console.log(`  ${from.code}  ${inr(fromBal)} → ${inr(fromBal + want)}`);
  console.log(`  ${to.code}  ${inr(toBal)} → ${inr(toBal - want)}`);

  if (!APPLY) { console.log("\nDRY RUN — set CONFIRM=YES to apply."); return; }

  const batch = randomUUID();
  await runWithSystemContext(to.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      const out = await tx.payment.create({
        data: {
          propertyId: from.propertyId, folioId: from.folio!.id, mode: "CASH",
          amountPaise: want, isRefund: true, settlementBatchId: batch,
          reference: `Credit moved to ${to.code}`,
        },
        select: { id: true },
      });
      const into = await tx.payment.create({
        data: {
          propertyId: to.propertyId, folioId: to.folio!.id, mode: "CASH",
          amountPaise: want, isRefund: false, settlementBatchId: batch,
          reference: `Credit moved from ${from.code}`,
        },
        select: { id: true },
      });
      await writeAudit(tx, {
        action: "folio:move-credit", entityType: "Payment", entityId: into.id, propertyId: to.propertyId,
        reason: `credit moved from ${from.code} to ${to.code} (same guest, linked stay)`,
        before: { fromFolioId: from.folio!.id, fromBalancePaise: Number(fromBal) },
        after: { toFolioId: to.folio!.id, amountPaise: Number(want), outPaymentId: out.id },
      });
    });
  });

  const after = await prisma.reservation.findMany({
    where: { id: { in: [from.id, to.id] } },
    select: { code: true, folio: { select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } } },
  });
  console.log("\n=== AFTER ===");
  for (const r of after) console.log(`  ${r.code}  balance ${inr(folioBalance(r.folio!.lines, r.folio!.payments))}`);
}

main()
  .catch((e) => { console.error("FAILED:", e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
