/**
 * Saumen Chatterjee (Joint Plant Committee), BK-RW1DQ2ET, HKD23 R1+R2.
 * The stay's nights were corrected on the folio to ₹6,000/night (pre-tax), but
 * the booking kept ₹5,000 — so the 10 Nov extension (12→30 Nov, 18 nights)
 * billed "same rate as now" at ₹5,000. Re-price those 18 nights to ₹6,000 +
 * GST (reverse + re-post, append-only) and set the booking's rate to ₹6,000 so
 * check-out and any further extension use it. Bill otherwise untouched.
 *   npx tsx scripts/fix-saumen-extension-rate.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-saumen-extension-rate.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { activeLines, folioBalance, nextRoomRevision, postRoomChargesTx, type BillingBulkTx } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const OLD = 500_000, NEW = 600_000;

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-RW1DQ2ET" },
    select: {
      id: true, propertyId: true, status: true, ratePaise: true,
      property: { select: { orgId: true, state: true } },
      folio: { select: { id: true, lines: true, payments: { select: { amountPaise: true, isRefund: true } }, invoices: { select: { number: true, type: true } } } },
    },
  });
  const folio = r.folio!;
  const wrong = activeLines(folio.lines).filter((l) => l.type === "ROOM" && l.unitPaise === OLD).sort((a, b) => a.businessDate.getTime() - b.businessDate.getTime());
  const right = activeLines(folio.lines).filter((l) => l.type === "ROOM" && l.unitPaise === NEW);
  const key = (d: Date) => d.toISOString().slice(0, 10);
  console.log(`${r.status} · booking rate ${inr(r.ratePaise)} · balance ${inr(folioBalance(folio.lines, folio.payments))} · invoices ${folio.invoices.map((i) => i.number).join(", ") || "none"}`);
  console.log(`nights at ₹6,000: ${right.length} · nights at ₹5,000 to fix: ${wrong.length} (${wrong[0] ? key(wrong[0].businessDate) : "-"} … ${wrong.at(-1) ? key(wrong.at(-1)!.businessDate) : "-"})`);
  if (wrong.length === 0) { console.log("Nothing to fix."); return; }
  const delta = wrong.length * (NEW - OLD) * 1.05;
  console.log(`bill goes up by ${inr(delta)} (${wrong.length} × ₹1,000 + 5% GST)`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.folioLine.createMany({
        data: wrong.map((l) => ({
          folioId: folio.id, type: "REVERSAL" as const, description: `Reversal: ${l.description} (extension billed at the old ₹5,000 — agreed ₹6,000)`,
          quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
          cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise, hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
          businessDate: new Date(), reversalOfId: l.id, postedById: null,
        })),
      });
      await postRoomChargesTx(tx as unknown as BillingBulkTx, wrong.map((l) => ({
        folioId: folio.id, propertyId: r.propertyId, propertyState: r.property.state, ratePaise: NEW,
        businessDate: l.businessDate, revision: nextRoomRevision(folio.lines, l.businessDate),
        postedById: null, description: "Room R1, R2 · night (extended)",
      })));
      await tx.reservation.update({ where: { id: r.id }, data: { ratePaise: NEW } });
      await tx.domainEvent.create({ data: { orgId: r.property.orgId, propertyId: r.propertyId, type: "ReservationModified", aggregateId: r.id, payload: { ratePaise: NEW, reason: "extension-rate-correct" } } });
      await writeAudit(tx, {
        action: "reservation:set-rate", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
        reason: "Extension 12→30 Nov billed at the booking's stale ₹5,000; the stay's agreed rate is ₹6,000 — script",
        before: { ratePaise: OLD }, after: { ratePaise: NEW, nightsRepriced: wrong.length },
      });
    }, { maxWait: 10_000, timeout: 60_000 });
  });
  const after = await prisma.folio.findUniqueOrThrow({ where: { id: folio.id }, select: { lines: true, payments: { select: { amountPaise: true, isRefund: true } } } });
  console.log(`✅ Done. Balance now ${inr(folioBalance(after.lines, after.payments))}; booking rate ₹6,000.`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
