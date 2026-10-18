/**
 * Yvo Bekx · BK-NWYG7TES · D-1/17 room 3F-3 — re-date the 7-night charge.
 *
 * The stay: 7 nights booked via Airbnb (30 Sep → 7 Oct), checked in 30 Sep,
 * departed 1 Oct. Airbnb paid the whole booked stay — ₹14,000 + ₹700 GST,
 * settled by bank transfer, balance ₹0 — and 3F-3 was resold for 3–8 Oct to
 * other guests. So the money is right and the 1-night reservation record is
 * right; only the FOLIO was wrong.
 *
 * The old `correctRoomRate` had folded all 7 nights into one ROOM line parked on
 * 21 Jul 2026 — before the stay even began — so ₹14,000 of Sept/Oct revenue was
 * reported in July. The generic re-dating script (split-aggregate-room-lines)
 * deliberately refuses this one: its guard is "quantity must equal the stay's
 * unbilled nights", and here 7 ≠ 1, which means the AMOUNT needed a decision
 * rather than a mechanical re-date.
 *
 * Decision (client, 18 Oct 2026): book all 7 nights as ROOM revenue across the
 * BOOKED nights, 30 Sep – 6 Oct @ ₹2,000. Noted at the time that 3F-3 was also
 * sold to other guests for 3–7 Oct, so room revenue — and therefore ADR/RevPAR —
 * for those dates now counts both this booking and the guest who actually
 * occupied the room. The client chose this over booking the 6 unused nights as a
 * cancellation retention charge.
 *
 * Totals are unchanged to the paisa: 7 × ₹2,000 = ₹14,000, and 7 × ₹100 GST =
 * ₹700, which is exactly the aggregate's GST (no rounding drift at this rate).
 *
 *   npx tsx scripts/fix-yvo-bekx-nights.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-yvo-bekx-nights.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { folioBalance } from "../src/features/billing";
import { activeLines, nextRoomRevision, dateKey } from "../src/features/billing/domain/reversal";
import { computeGst } from "../src/features/billing/domain/gst";
import { roomGstBps } from "../src/lib/constants/gst";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const CODE = "BK-NWYG7TES";
const RATE = 200_000;              // ₹2,000 pre-tax, the corrected Airbnb rate
const FIRST_NIGHT = "2026-09-30";  // booked check-in
const AFTER_LAST = "2026-10-07";   // booked check-out (exclusive)

async function main() {
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: CODE },
    select: {
      id: true, code: true, status: true,
      folio: { select: { id: true } },
      property: { select: { id: true, orgId: true, state: true, name: true } },
      allocations: { select: { room: { select: { number: true } } } },
    },
  });
  const folioId = r.folio!.id;
  const rows = await prisma.folioLine.findMany({
    where: { folioId },
    select: { id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true, taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true, placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true },
  });
  const folio = await prisma.folio.findUniqueOrThrow({
    where: { id: folioId },
    select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } },
  });
  const before = folioBalance(folio.lines, folio.payments);

  const aggregates = activeLines(rows).filter((l) => l.type === "ROOM" && l.quantity > 1);
  if (aggregates.length === 0) { console.log("Nothing to do — no active aggregate ROOM line."); return; }

  const nights: Date[] = [];
  for (let t = utc(FIRST_NIGHT).getTime(); t < utc(AFTER_LAST).getTime(); t += 86_400_000) nights.push(new Date(t));

  const roomNo = r.allocations[0]?.room.number ?? "";
  const bps = roomGstBps(RATE);
  const per = computeGst(RATE, bps, r.property.state, r.property.state);

  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];
  let baseSum = 0n, gstSum = 0, aggBase = 0n, aggGst = 0;

  console.log(`${r.code} [${r.status}] @ ${r.property.name} room ${roomNo}`);
  console.log(`  before: balance ${inr(before)}`);
  for (const l of aggregates) {
    aggBase += BigInt(l.amountPaise);
    aggGst += l.cgstPaise + l.sgstPaise + l.igstPaise;
    inserts.push({
      folioId, type: "REVERSAL",
      description: `Reversal: ${l.description} (re-dated to the booked nights)`,
      quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
      cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
      hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
      businessDate: new Date(), reversalOfId: l.id,
    });
    console.log(`  − reverse ${dateKey(l.businessDate)} ${l.quantity} × ${inr(l.unitPaise)} = ${inr(l.amountPaise)} (+gst ${inr(l.cgstPaise + l.sgstPaise + l.igstPaise)})`);
  }

  const seen = rows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
  for (const d of nights) {
    const rev = nextRoomRevision(seen as never, d);
    seen.push({ type: "ROOM", businessDate: d, revision: rev });
    inserts.push({
      folioId, type: "ROOM", description: `Room ${roomNo} · night`.trim(), quantity: 1,
      unitPaise: RATE, amountPaise: BigInt(RATE), taxRateBps: bps,
      cgstPaise: per.cgstPaise, sgstPaise: per.sgstPaise, igstPaise: per.igstPaise,
      hsnSac: "996311", placeOfSupplyState: r.property.state,
      businessDate: d, revision: rev,
    });
    baseSum += BigInt(RATE);
    gstSum += per.cgstPaise + per.sgstPaise + per.igstPaise;
    console.log(`  + post    ${dateKey(d)} ROOM ${inr(RATE)} (+gst ${inr(per.cgstPaise + per.sgstPaise + per.igstPaise)}) rev ${rev}`);
  }

  console.log(`  totals: base ${inr(baseSum)} vs ${inr(aggBase)} · gst ${inr(gstSum)} vs ${inr(aggGst)}`);
  if (baseSum !== aggBase || gstSum !== aggGst) {
    throw new Error("total would move — refusing to apply");
  }

  if (!APPLY) { console.log(`\n${inserts.length} line(s) to append. DRY RUN — set CONFIRM=YES to apply.`); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });
    });
  });

  const after = await prisma.folio.findUniqueOrThrow({
    where: { id: folioId },
    select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } },
  });
  console.log(`\nApplied. balance ${inr(before)} → ${inr(folioBalance(after.lines, after.payments))}`);
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
