/**
 * Archana, BK-HNUKDW1X (HKD17, 3F-3) — Airbnb, prepaid ₹34,397 for 15→28 Nov,
 * left after one night (checked out 16 Nov). Early check-out billed 1 night and
 * left −₹31,751 as a refund due. The Airbnb money is prepaid & non-refundable,
 * so keep it as an early-departure charge (same rule the check-out now offers):
 *  - post "Early departure charge — 12 unused night(s) from 16 Nov (prepaid,
 *    non-refundable)" = the prepaid excess, GST 5% inside, on the Airbnb bill;
 *  - nights stay reversed (room free, occupancy true) → balance ₹0.
 * Invoice WASPL 1031 (₹2,646) is NOT touched — Void & revise it in the app.
 *
 * Run inside the app container:
 *   npx tsx scripts/fix-archana-early-departure.ts              (dry-run)
 *   CONFIRM=YES npx tsx scripts/fix-archana-early-departure.ts  (apply)
 */
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { folioBalance } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const FIRST_UNUSED = new Date("2026-11-16T00:00:00Z");

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: "BK-HNUKDW1X" },
    select: {
      id: true, status: true, source: true, propertyId: true,
      guest: { select: { fullName: true } },
      property: { select: { orgId: true } },
      folio: { select: { id: true, lines: true, payments: true } },
    },
  });
  if (!r.guest.fullName.toLowerCase().includes("archana")) throw new Error("unexpected guest");
  if (r.status !== "CHECKED_OUT" || r.source !== "AIRBNB") throw new Error(`unexpected ${r.status}/${r.source}`);
  const folio = r.folio!;
  if (folio.lines.some((l) => l.description.startsWith("Early departure charge"))) throw new Error("already applied");
  const balance = Number(folioBalance(folio.lines, folio.payments));
  if (balance >= 0) throw new Error(`no prepaid excess (balance ${inr(balance)})`);
  const keep = -balance;
  const reversedNights = folio.lines.filter((l) => l.type === "REVERSAL" && l.description.includes("(early check-out)"));
  const bps = 500;
  const pre = Math.round((keep * 10_000) / (10_000 + bps));
  const gst = keep - pre;
  const cgst = Math.floor(gst / 2);
  const desc = `Early departure charge — ${reversedNights.length} unused night(s) from 16 Nov (Airbnb prepaid, non-refundable)`;

  console.log(`${r.guest.fullName} · ${r.status} · ${r.source} · balance now ${inr(balance)}`);
  console.log(`  post: ${desc}`);
  console.log(`        ${inr(pre)} + CGST ${inr(cgst)} + SGST ${inr(gst - cgst)} = ${inr(keep)}  → balance ₹0.00`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      const line = await tx.folioLine.create({ data: {
        folioId: folio.id, type: "MISC", description: desc, quantity: 1, unitPaise: pre, amountPaise: BigInt(pre),
        taxRateBps: bps, cgstPaise: cgst, sgstPaise: gst - cgst, igstPaise: 0, hsnSac: "996311",
        placeOfSupplyState: reversedNights[0]?.placeOfSupplyState ?? null, businessDate: FIRST_UNUSED,
      }, select: { id: true } });
      await writeAudit(tx, {
        action: "folio:early-departure-retain", entityType: "FolioLine", entityId: line.id, propertyId: r.propertyId,
        reason: "Airbnb prepaid, non-refundable — guest left after 1 of 13 nights",
        after: { amountPaise: keep, reservation: "BK-HNUKDW1X" },
      });
    });
  });
  const after = await prisma.folio.findUniqueOrThrow({ where: { id: folio.id }, select: { lines: true, payments: true } });
  console.log(`✅ Done. Balance now ${inr(folioBalance(after.lines, after.payments))}. Next: Void & revise invoice WASPL 1031 in the app.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
