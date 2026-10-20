/**
 * Re-price folios whose room rate drifted above the rate the booking agreed.
 *
 * Seven Sept/early-Oct stays bill a little more per night than the booking says,
 * and in every one the folio rate is the booking rate × 1.0667 — which is
 * 1.12 ÷ 1.05. They were priced under the old 12% room-GST assumption and then
 * re-based to 5% by backing the tax out of the GROSS, which leaves the pre-tax
 * rate carrying the 12/5 difference for ever.
 *
 *   BK-F8LMSPZT  booking ₹2,100 · folio ₹2,240   (2,100 × 1.12 ÷ 1.05)
 *   BK-3POSAQRI  booking ₹2,100 · folio ₹2,240
 *   BK-3PZHMCGN  booking ₹2,500 · folio ₹2,666.66
 *   …and so on
 *
 * So the guest was quoted and paid the booking rate, and the folio has been
 * showing a balance they never owed — ₹2,352 across the seven, reported as
 * outstanding dues against guests who left weeks ago. The fix is to put the
 * folio back on the agreed rate, not to write the difference off: writing it off
 * would record a concession where there was only a pricing error.
 *
 * Each night is reversed and re-posted at the booking's `ratePaise` on its own
 * business date, so per-night revenue and every date-keyed metric stay right.
 *
 * BK-L94SZJSR is deliberately NOT in the list. Its folio rate already matches
 * the booking; what it carries instead is a fourth room-night on a three-night
 * stay plus a ₹107.50 line typed as ROOM that is not a night at all. That is an
 * amount question, already flagged separately, and re-pricing would make it worse.
 *
 *   npx tsx scripts/fix-stale-folio-rates.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-stale-folio-rates.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";
import { folioBalance } from "../src/features/billing";
import { activeLines, nextRoomRevision, dateKey } from "../src/features/billing/domain/reversal";
import { computeGst } from "../src/features/billing/domain/gst";
import { roomGstBps } from "../src/lib/constants/gst";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const CODES = [
  "BK-F8LMSPZT", "BK-3PZHMCGN", "BK-2KGJ2PN2",
  "BK-B0OS5H5Q", "BK-7ZXO4I8Z", "BK-B1817YQO", "BK-3POSAQRI",
];

const LINE_SELECT = {
  id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
  taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
  placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
} as const;

async function main() {
  let before = 0n, after = 0n;

  for (const code of CODES) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code },
      select: {
        id: true, code: true, ratePaise: true, propertyId: true,
        property: { select: { orgId: true, name: true, state: true } },
        folio: { select: { id: true, lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } },
      },
    });
    const rows = await prisma.folioLine.findMany({ where: { folioId: r.folio!.id }, select: LINE_SELECT });
    const nights = activeLines(rows).filter((l) => l.type === "ROOM" && l.unitPaise !== r.ratePaise)
      .sort((a, b) => a.businessDate.getTime() - b.businessDate.getTime());
    const bal0 = folioBalance(r.folio!.lines, r.folio!.payments);
    before += bal0;

    if (nights.length === 0) { console.log(`${code}: already at the booking rate — skipping`); after += bal0; continue; }

    const bps = roomGstBps(r.ratePaise);
    const gst = computeGst(r.ratePaise, bps, r.property.state, r.property.state);
    const perNight = BigInt(r.ratePaise) + BigInt(gst.cgstPaise + gst.sgstPaise + gst.igstPaise);
    let removed = 0n;
    const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];
    const seen = rows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));

    for (const l of nights) {
      removed += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
      inserts.push({
        folioId: r.folio!.id, type: "REVERSAL",
        description: `Reversal: ${l.description} (folio rate was above the booking's agreed rate)`,
        quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
        hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
        businessDate: new Date(), reversalOfId: l.id,
      });
      const rev = nextRoomRevision(seen as never, l.businessDate);
      seen.push({ type: "ROOM", businessDate: l.businessDate, revision: rev });
      inserts.push({
        folioId: r.folio!.id, type: "ROOM",
        description: `${(l.description || "Room").split(" · ")[0]} · night (agreed rate)`,
        quantity: 1, unitPaise: r.ratePaise, amountPaise: BigInt(r.ratePaise), taxRateBps: bps,
        cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
        hsnSac: "996311", placeOfSupplyState: r.property.state,
        businessDate: l.businessDate, revision: rev,
      });
    }
    const bal1 = bal0 - removed + perNight * BigInt(nights.length);
    after += bal1;
    console.log(`${code.padEnd(13)} ${nights.length} night(s)  ${inr(nights[0]!.unitPaise)} → ${inr(r.ratePaise)}   balance ${inr(bal0)} → ${inr(bal1)}`);

    if (!APPLY) continue;
    await runWithSystemContext(r.property.orgId, async () => {
      await prisma.$transaction(async (tx) => {
        for (const data of inserts) await tx.folioLine.create({ data });
        await writeAudit(tx, {
          action: "folio:correct-rate", entityType: "Folio", entityId: r.folio!.id, propertyId: r.propertyId,
          reason: "folio rate carried the old 12% GST basis; put back on the booking's agreed rate",
          after: { bookingCode: code, ratePaise: r.ratePaise, nights: nights.length },
        });
      });
    });
  }

  console.log(`\ntotal balance on these folios: ${inr(before)} → ${inr(after)}`);
  if (!APPLY) console.log("DRY RUN — set CONFIRM=YES to apply.");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
