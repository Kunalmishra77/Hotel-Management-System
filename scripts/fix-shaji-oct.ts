/**
 * Shaji / Shaji Paul, Oct 2026 — one guest, rooms priced at ₹2,700 + GST.
 *
 * Client confirmation (20 Oct 2026): every room is ₹2,700 PLUS GST, and the
 * ₹5,000 taken on 15 Oct was an advance for the D-1/23 stay, not the D-1/17 one
 * it was posted against.
 *
 * Three things are wrong:
 *
 *  1. BK-9H8JR1PZ (D-1/23, R1+R2, 17→20 Oct, checking out today) carries
 *     ₹5,142.86/night — ₹2,571.43 a room, which is ₹2,700 with the GST taken OUT
 *     rather than added on. Two rooms at ₹2,700 + GST is ₹5,400/night.
 *  2. BK-9HQHMWEJ (D-1/17, 3F-1+3F-2+3F-3, 18→19 Oct) was "corrected" today to
 *     ₹2,700 — but that is the rate for ONE room, and this booking holds THREE.
 *     `ratePaise` on a multi-room booking is the total for all its rooms, so the
 *     three rooms billed as one.
 *  3. BK-DKSP95KC (D-1/17, GF-3, 18→19 Oct) carries ₹2,571.48 — the same
 *     GST-inclusive entry as (1).
 *
 * The ₹5,000 also moves to the folio it was meant for. Append-only throughout:
 * reversals and re-posts for charges, a paired out/in for the payment.
 *
 *   npx tsx scripts/fix-shaji-oct.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-shaji-oct.ts  (apply)
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
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

const PER_ROOM = 270_000; // ₹2,700 pre-tax, per room, per night

/** Each booking and what its nightly rate should be = rooms × ₹2,700. */
const TARGETS = [
  { code: "BK-9H8JR1PZ", rooms: 2, note: "D-1/23 R1+R2, checking out today" },
  { code: "BK-9HQHMWEJ", rooms: 3, note: "D-1/17 3F-1+3F-2+3F-3" },
  { code: "BK-DKSP95KC", rooms: 1, note: "D-1/17 GF-3" },
];

const LINE_SELECT = {
  id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
  taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
  placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
} as const;

async function main() {
  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];
  const rateUpdates: { id: string; code: string; ratePaise: number }[] = [];
  let orgId = "";

  for (const t of TARGETS) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code: t.code },
      select: {
        id: true, code: true, ratePaise: true, propertyId: true, nights: true,
        property: { select: { orgId: true, name: true, state: true } },
        allocations: { select: { room: { select: { number: true } } } },
        folio: { select: { id: true } },
      },
    });
    orgId ||= r.property.orgId;
    const target = PER_ROOM * t.rooms;
    const rows = await prisma.folioLine.findMany({ where: { folioId: r.folio!.id }, select: LINE_SELECT });
    const nights = activeLines(rows).filter((l) => l.type === "ROOM").sort((a, b) => a.businessDate.getTime() - b.businessDate.getTime());

    console.log(`\n${r.code} — ${t.note}`);
    console.log(`  rooms ${r.allocations.map((a) => a.room.number).join("+")} · rate ${inr(r.ratePaise)} → ${inr(target)} (${t.rooms} × ${inr(PER_ROOM)})`);
    if (r.ratePaise !== target) rateUpdates.push({ id: r.id, code: r.code, ratePaise: target });

    const bps = roomGstBps(PER_ROOM);
    const gst = computeGst(target, bps, r.property.state, r.property.state);
    const seen = rows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
    let before = 0n, after = 0n;
    for (const l of nights) {
      before += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise);
      if (l.unitPaise === target) { after += BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise); console.log(`    ${dateKey(l.businessDate)} already ${inr(target)} — left alone`); continue; }
      inserts.push({
        folioId: r.folio!.id, type: "REVERSAL",
        description: `Reversal: ${l.description} (re-priced to ₹2,700 + GST per room)`,
        quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
        cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
        hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
        businessDate: new Date(), reversalOfId: l.id,
      });
      const rev = nextRoomRevision(seen as never, l.businessDate);
      seen.push({ type: "ROOM", businessDate: l.businessDate, revision: rev });
      inserts.push({
        folioId: r.folio!.id, type: "ROOM",
        description: `Room ${r.allocations.map((a) => a.room.number).join("+")} · night (${t.rooms} room${t.rooms > 1 ? "s" : ""} @ ₹2,700 + GST)`,
        quantity: 1, unitPaise: target, amountPaise: BigInt(target), taxRateBps: bps,
        cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
        hsnSac: "996311", placeOfSupplyState: r.property.state,
        businessDate: l.businessDate, revision: rev,
      });
      after += BigInt(target) + BigInt(gst.cgstPaise) + BigInt(gst.sgstPaise) + BigInt(gst.igstPaise);
      console.log(`    ${dateKey(l.businessDate)} ${inr(l.unitPaise)} → ${inr(target)}`);
    }
    console.log(`  folio room charges ${inr(before)} → ${inr(after)}`);
  }

  // ---- the ₹5,000 advance belongs to the D-1/23 stay ----------------------
  const from = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-9HQHMWEJ" }, select: { id: true, code: true, propertyId: true, folio: { select: { id: true } } } });
  const to = await prisma.reservation.findFirstOrThrow({ where: { code: "BK-9H8JR1PZ" }, select: { id: true, code: true, propertyId: true, folio: { select: { id: true } } } });
  const advance = await prisma.payment.findFirst({
    where: { folioId: from.folio!.id, amountPaise: 500_000, isRefund: false },
    select: { id: true, amountPaise: true, mode: true, receivedAt: true },
  });
  console.log(`\n₹5,000 advance → ${to.code} (D-1/23)`);
  if (!advance) console.log("  (already moved — no ₹5,000 payment left on BK-9HQHMWEJ)");
  else console.log(`  moving the ${advance.mode} payment of ${inr(advance.amountPaise)} taken ${advance.receivedAt.toISOString().slice(0, 10)}`);

  if (!APPLY) {
    console.log(`\n${inserts.length} folio line(s), ${rateUpdates.length} rate update(s), ${advance ? 1 : 0} payment move.`);
    console.log("DRY RUN — set CONFIRM=YES to apply.");
    return;
  }

  await runWithSystemContext(orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });
      for (const u of rateUpdates) {
        await tx.reservation.update({ where: { id: u.id }, data: { ratePaise: u.ratePaise } });
        await writeAudit(tx, {
          action: "reservation:set-rate", entityType: "Reservation", entityId: u.id, propertyId: orgId,
          reason: "₹2,700 + GST per room (client confirmation)", after: { ratePaise: u.ratePaise },
        });
      }
      if (advance) {
        const batch = randomUUID();
        await tx.payment.create({ data: { propertyId: from.propertyId, folioId: from.folio!.id, mode: "CASH", amountPaise: BigInt(advance.amountPaise), isRefund: true, settlementBatchId: batch, reference: `Advance re-allocated to ${to.code}` }, select: { id: true } });
        const into = await tx.payment.create({ data: { propertyId: to.propertyId, folioId: to.folio!.id, mode: "CASH", amountPaise: BigInt(advance.amountPaise), isRefund: false, settlementBatchId: batch, reference: `Advance received 15 Oct for ${to.code}`, receivedAt: advance.receivedAt }, select: { id: true } });
        await writeAudit(tx, {
          action: "folio:move-credit", entityType: "Payment", entityId: into.id, propertyId: to.propertyId,
          reason: "₹5,000 advance was taken for the D-1/23 stay but posted to the D-1/17 booking",
          after: { fromFolioId: from.folio!.id, toFolioId: to.folio!.id, amountPaise: Number(advance.amountPaise) },
        });
      }
    });
  });

  console.log("\n=== AFTER ===");
  for (const t of [...TARGETS]) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code: t.code },
      select: { code: true, status: true, ratePaise: true, folio: { select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } } },
    });
    const bal = folioBalance(r.folio!.lines, r.folio!.payments);
    console.log(`  ${r.code} [${r.status}] rate ${inr(r.ratePaise)} → balance ${inr(bal)}`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
