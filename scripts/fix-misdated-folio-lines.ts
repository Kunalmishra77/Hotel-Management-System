/**
 * Move folio lines that are dated OUTSIDE their own stay onto a date inside it.
 *
 * Two sources, same symptom. `postFolioCharge` defaults a charge's business date
 * to the property's `currentBusinessDate`, so while that was still the go-live
 * value (21 Jul 2026) every manually-added FOOD / TAXI / MISC charge landed
 * there — months before the stay it belongs to. And the old `correctRoomRate`
 * parked its re-priced line on the first business date with no room line, which
 * for a single-night correction was likewise 21 Jul (or the day after a short
 * stay). The money was always right; the DATE was not, and every date-keyed
 * figure reads it — so October revenue was reported in July.
 *
 * Where the correct date is DERIVABLE it is used; where it is not, the stay's
 * check-in date is used, which is inside the stay and therefore in the right
 * month and the right report:
 *
 *   ROOM  → the stay's nights that carry no active room charge. Applied only
 *           when the count matches exactly; otherwise the line is a question
 *           about the AMOUNT, not the date, and is reported instead.
 *   other → the stay's check-in date. "1 dinner and 3 breakfast" over a 4-night
 *           stay cannot be attributed to one night from the data, and any date
 *           inside the stay gives the same answer in every monthly report.
 *
 * NOT touched:
 *   · DISCOUNT lines dated after check-out — a discount or goodwill adjustment
 *     agreed after departure genuinely belongs to the day it was agreed.
 *   · BK-NWYG7TES (Yvo Bekx) — its nights sit outside the 1-night reservation by
 *     the client's explicit decision (Airbnb paid the full 7-night booking).
 *
 * Append-only: reverse, then re-post with the SAME amounts and GST on the new
 * date, so no folio balance moves.
 *
 *   npx tsx scripts/fix-misdated-folio-lines.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-misdated-folio-lines.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { activeLines, nextRoomRevision, dateKey } from "../src/features/billing/domain/reversal";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** Decided separately with the client — its nights are deliberately outside the stay. */
const EXCLUDE_CODES = new Set(["BK-NWYG7TES"]);

async function main() {
  const all = await prisma.folioLine.findMany({
    where: { folio: { reservation: { isNot: null } } },
    select: {
      id: true, folioId: true, type: true, description: true, quantity: true, unitPaise: true,
      amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true,
      hsnSac: true, placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
      folio: { select: { propertyId: true, reservation: { select: { id: true, code: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } } } } } },
    },
  });

  const live = activeLines(all);
  const suspects = live.filter((l) => {
    const r = l.folio.reservation!;
    if (EXCLUDE_CODES.has(r.code)) return false;
    if (l.type === "DISCOUNT") return false;
    const k = dateKey(l.businessDate);
    return k < dateKey(r.checkInDate) || k > dateKey(r.checkOutDate);
  });

  // Group by folio so room-night placement sees all of a folio's lines at once.
  const byFolio = new Map<string, typeof suspects>();
  for (const l of suspects) {
    byFolio.set(l.folioId, [...(byFolio.get(l.folioId) ?? []), l]);
  }

  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];
  const skipped: string[] = [];
  let orgId = "";

  for (const [folioId, group] of byFolio) {
    const r = group[0]!.folio.reservation!;
    const prop = await prisma.property.findUniqueOrThrow({ where: { id: group[0]!.folio.propertyId }, select: { orgId: true, name: true } });
    orgId ||= prop.orgId;

    const folioRows = all.filter((x) => x.folioId === folioId);
    const seen = folioRows.map((x) => ({ type: x.type, businessDate: x.businessDate, revision: x.revision }));
    // Stay nights with no active room charge — where a misplaced ROOM line belongs.
    const billed = new Set(activeLines(folioRows).filter((x) => x.type === "ROOM").map((x) => dateKey(x.businessDate)));
    const free: string[] = [];
    for (let t = r.checkInDate.getTime(); t < r.checkOutDate.getTime(); t += 86_400_000) {
      const k = dateKey(new Date(t));
      if (!billed.has(k)) free.push(k);
    }

    console.log(`\n${r.code} ${r.guest.fullName} @ ${prop.name} · stay ${dateKey(r.checkInDate)} → ${dateKey(r.checkOutDate)}`);
    const rooms = group.filter((l) => l.type === "ROOM");
    const others = group.filter((l) => l.type !== "ROOM");

    const roomNights = rooms.reduce((n, l) => n + l.quantity, 0);
    if (rooms.length > 0 && roomNights !== free.length) {
      for (const l of rooms) {
        skipped.push(`${r.code}: ROOM ${inr(l.amountPaise)} on ${dateKey(l.businessDate)} — ${roomNights} night(s) to place but ${free.length} unbilled night(s) in the stay`);
        console.log(`  ? ROOM ${inr(l.amountPaise)} on ${dateKey(l.businessDate)} — SKIPPED (${roomNights} vs ${free.length} unbilled nights)`);
      }
    } else {
      let i = 0;
      for (const l of rooms) {
        for (let q = 0; q < l.quantity; q++) {
          const target = new Date(`${free[i++]}T00:00:00.000Z`);
          const rev = nextRoomRevision(seen as never, target);
          seen.push({ type: "ROOM", businessDate: target, revision: rev });
          inserts.push({
            folioId, type: "ROOM", description: l.description, quantity: 1,
            unitPaise: l.unitPaise, amountPaise: BigInt(l.unitPaise), taxRateBps: l.taxRateBps,
            // GST is per-night when a multi-night line is spread; at quantity 1 it
            // is simply carried across unchanged.
            cgstPaise: Math.round(l.cgstPaise / l.quantity), sgstPaise: Math.round(l.sgstPaise / l.quantity), igstPaise: Math.round(l.igstPaise / l.quantity),
            hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
            businessDate: target, revision: rev,
          });
          console.log(`  → ROOM ${inr(l.unitPaise)} ${dateKey(l.businessDate)} ⇒ ${free[i - 1]} (rev ${rev})`);
        }
        inserts.push(reversal(folioId, l, "re-dated into the stay"));
      }
    }

    for (const l of others) {
      const target = r.checkInDate;
      inserts.push(reversal(folioId, l, "re-dated into the stay"));
      inserts.push({
        folioId, type: l.type as Prisma.FolioLineUncheckedCreateInput["type"], description: l.description,
        quantity: l.quantity, unitPaise: l.unitPaise, amountPaise: l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: l.cgstPaise, sgstPaise: l.sgstPaise, igstPaise: l.igstPaise,
        hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
        businessDate: target, revision: 0,
      });
      console.log(`  → ${l.type} ${inr(l.amountPaise)} ${dateKey(l.businessDate)} ⇒ ${dateKey(target)} (check-in)  "${l.description.trim()}"`);
    }
  }

  if (skipped.length > 0) {
    console.log("\nSKIPPED — the amount, not the date, needs a decision:");
    for (const s of skipped) console.log(`  · ${s}`);
  }
  console.log(`\n${inserts.length} line(s) to append.`);
  if (!APPLY) { console.log("DRY RUN — set CONFIRM=YES to apply."); return; }

  await runWithSystemContext(orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });
    });
  });
  console.log("Applied.");
}

type Row = { id: string; description: string; unitPaise: number; amountPaise: bigint; taxRateBps: number; cgstPaise: number; sgstPaise: number; igstPaise: number; hsnSac: string | null; placeOfSupplyState: string | null };
function reversal(folioId: string, l: Row, reason: string): Prisma.FolioLineUncheckedCreateInput {
  return {
    folioId, type: "REVERSAL", description: `Reversal: ${l.description} (${reason})`,
    quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
    cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
    hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
    businessDate: new Date(), reversalOfId: l.id,
  };
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
