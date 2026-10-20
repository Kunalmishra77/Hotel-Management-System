/**
 * Shaji — final correction. ₹2,700 per room INCLUSIVE of GST.
 *
 * Client confirmation (20 Oct 2026), which corrects my earlier reading of
 * "₹2,700 + GST":
 *
 *   D-1/17  18→19 Oct  4 rooms  @ ₹2,700 all-in  → ₹10,800   paid in cash
 *   D-1/23  17→20 Oct  2 rooms  @ ₹2,700 all-in  → ₹16,200   paid in full
 *   D-1/23  22→24 Oct  future booking            → NOT TOUCHED
 *
 * So ₹2,700 is the taxable ₹2,571.43 plus ₹128.57 GST, not ₹2,700 plus ₹135.
 * This undoes the "+ GST" re-pricing I applied earlier today and puts every
 * room back on the inclusive basis.
 *
 * It also puts the ₹5,000 of 15 Oct back on the D-1/17 booking. I moved it to
 * D-1/23 on the client's first description, but D-1/23's own payments today —
 * ₹6,200 UPI + ₹10,000 cash — already come to exactly its ₹16,200 bill, so the
 * advance was never part of it.
 *
 * Finally the four rooms become ONE booking and ONE bill, as asked: GF-3 and its
 * payment move onto BK-9HQHMWEJ and the emptied BK-DKSP95KC is cancelled so it
 * stops counting as a separate stay.
 *
 * Invoices are left alone — WASPL :812, :813 and :819 will disagree with their
 * folios, and the folio screen already flags that and offers Void & revise →
 * Generate GST invoice, which keeps the gap-free numbering inside the app.
 *
 *   npx tsx scripts/fix-shaji-final.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-shaji-final.ts  (apply)
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
import { preTaxRatePaise } from "../src/features/reservations/domain/pricing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

/** ₹2,700 all-in → the taxable rate the folio stores. */
const PER_ROOM = preTaxRatePaise(270_000, "inclusive");

const KEEP = "BK-9HQHMWEJ";     // 3F-1+3F-2+3F-3, ends up holding all four rooms
const ABSORB = "BK-DKSP95KC";   // GF-3, folded in then cancelled
const HKD23 = "BK-9H8JR1PZ";    // D-1/23, 2 rooms — rate back to inclusive
// BK-9HBQP1YV (22→24 Oct) is deliberately absent: the client asked us to leave it.

const LINE_SELECT = {
  id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
  taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
  placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
} as const;
const RES_SELECT = {
  id: true, code: true, status: true, propertyId: true, ratePaise: true,
  property: { select: { orgId: true, name: true, state: true } },
  allocations: { select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { number: true } } } },
  folio: { select: { id: true, lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { id: true, amountPaise: true, mode: true, isRefund: true, receivedAt: true, reference: true } } } },
} as const;

/** Reverse every active ROOM line and re-post it at `unit`, on its own night. */
function reprice(folioId: string, rows: Awaited<ReturnType<typeof loadRows>>, unit: number, state: string, description: string, why: string) {
  const out: Prisma.FolioLineUncheckedCreateInput[] = [];
  // The GST band is set by the PER-ROOM tariff, not the line total. A line
  // covering several rooms can exceed ₹7,500 while each room sits well under it,
  // and banding on the total would tax a ₹2,700 room at 18%.
  const bps = roomGstBps(PER_ROOM);
  const gst = computeGst(unit, bps, state, state);
  const seen = rows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
  for (const l of activeLines(rows).filter((l) => l.type === "ROOM")) {
    if (l.unitPaise === unit) { console.log(`    ${dateKey(l.businessDate)} already ${inr(unit)} — left alone`); continue; }
    out.push({
      folioId, type: "REVERSAL", description: `Reversal: ${l.description} (${why})`,
      quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
      cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
      hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
      businessDate: new Date(), reversalOfId: l.id,
    });
    const rev = nextRoomRevision(seen as never, l.businessDate);
    seen.push({ type: "ROOM", businessDate: l.businessDate, revision: rev });
    out.push({
      folioId, type: "ROOM", description, quantity: 1,
      unitPaise: unit, amountPaise: BigInt(unit), taxRateBps: bps,
      cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
      hsnSac: "996311", placeOfSupplyState: state,
      businessDate: l.businessDate, revision: rev,
    });
    console.log(`    ${dateKey(l.businessDate)} ${inr(l.unitPaise)} → ${inr(unit)}  (+GST ${inr(gst.cgstPaise + gst.sgstPaise + gst.igstPaise)} = ${inr(unit + gst.cgstPaise + gst.sgstPaise + gst.igstPaise)})`);
  }
  return out;
}
async function loadRows(folioId: string) {
  return prisma.folioLine.findMany({ where: { folioId }, select: LINE_SELECT });
}

async function main() {
  console.log(`₹2,700 all-in per room → taxable ${inr(PER_ROOM)} + GST\n`);
  const keep = await prisma.reservation.findFirstOrThrow({ where: { code: KEEP }, select: RES_SELECT });
  const absorb = await prisma.reservation.findFirstOrThrow({ where: { code: ABSORB }, select: RES_SELECT });
  const hkd23 = await prisma.reservation.findFirstOrThrow({ where: { code: HKD23 }, select: RES_SELECT });
  const orgId = keep.property.orgId;
  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];

  console.log(`${HKD23} — D-1/23, 2 rooms, back to ₹2,700 all-in`);
  inserts.push(...reprice(hkd23.folio!.id, await loadRows(hkd23.folio!.id), PER_ROOM * 2, hkd23.property.state,
    `Rooms ${hkd23.allocations.map((a) => a.room.number).join("+")} · night (2 rooms @ ₹2,700 incl. GST)`, "₹2,700 includes GST"));

  console.log(`\n${KEEP} — D-1/17, all four rooms on one bill`);
  inserts.push(...reprice(keep.folio!.id, await loadRows(keep.folio!.id), PER_ROOM * 4, keep.property.state,
    "Rooms 3F-1+3F-2+3F-3+GF-3 · night (4 rooms @ ₹2,700 incl. GST)", "four rooms on one bill, ₹2,700 includes GST"));

  console.log(`\n${ABSORB} — GF-3 folded into ${KEEP}`);
  for (const l of activeLines(await loadRows(absorb.folio!.id)).filter((l) => l.type === "ROOM")) {
    inserts.push({
      folioId: absorb.folio!.id, type: "REVERSAL", description: `Reversal: ${l.description} (room moved to ${KEEP})`,
      quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
      cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
      hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
      businessDate: new Date(), reversalOfId: l.id,
    });
    console.log(`    reverse ${inr(l.amountPaise)} — now billed on ${KEEP}`);
  }
  const absorbPaid = absorb.folio!.payments.reduce((s, x) => s + (x.isRefund ? -BigInt(x.amountPaise) : BigInt(x.amountPaise)), 0n);
  console.log(`    move ${inr(absorbPaid)} payment → ${KEEP}`);

  // The ₹5,000 advance belongs to the D-1/17 stay after all.
  const moved = hkd23.folio!.payments.find((p) => !p.isRefund && p.reference?.includes("Advance received 15 Oct"));
  console.log(`\n₹5,000 advance → back to ${KEEP}  ${moved ? "" : "(already back — nothing to undo)"}`);

  if (!APPLY) { console.log(`\n${inserts.length} folio line(s) + allocation move + payment moves.\nDRY RUN — set CONFIRM=YES.`); return; }

  await runWithSystemContext(orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });

      for (const a of absorb.allocations) {
        await tx.roomAllocation.delete({ where: { id: a.id } });
        await tx.roomAllocation.create({ data: { propertyId: keep.propertyId, reservationId: keep.id, roomId: a.roomId, startDate: a.startDate, endDate: a.endDate } });
      }
      await tx.reservation.update({ where: { id: keep.id }, data: { ratePaise: PER_ROOM * 4 } });
      await tx.reservation.update({ where: { id: hkd23.id }, data: { ratePaise: PER_ROOM * 2 } });

      const move = async (fromFolio: string, fromProp: string, amount: bigint, label: string, receivedAt?: Date) => {
        const batch = randomUUID();
        await tx.payment.create({ data: { propertyId: fromProp, folioId: fromFolio, mode: "CASH", amountPaise: amount, isRefund: true, settlementBatchId: batch, reference: `Moved to ${KEEP} — ${label}` }, select: { id: true } });
        await tx.payment.create({ data: { propertyId: keep.propertyId, folioId: keep.folio!.id, mode: "CASH", amountPaise: amount, isRefund: false, settlementBatchId: batch, reference: label, ...(receivedAt ? { receivedAt } : {}) }, select: { id: true } });
      };
      if (absorbPaid > 0n) await move(absorb.folio!.id, absorb.propertyId, absorbPaid, `GF-3 payment (was ${ABSORB})`, absorb.folio!.payments[0]?.receivedAt);
      if (moved) await move(hkd23.folio!.id, hkd23.propertyId, BigInt(moved.amountPaise), "Advance of 15 Oct (belongs to this stay)", moved.receivedAt);

      await tx.reservation.update({
        where: { id: absorb.id },
        data: { status: "CANCELLED", notes: `Merged into ${KEEP} — one guest, one 4-room stay on 18–19 Oct; GF-3 and its payment moved there.` },
      });
      await writeAudit(tx, {
        action: "reservation:modify", entityType: "Reservation", entityId: absorb.id, propertyId: absorb.propertyId,
        reason: `duplicate booking for the same 4-room stay; folded into ${KEEP}`,
        before: { status: absorb.status, rooms: absorb.allocations.map((a) => a.room.number) },
        after: { status: "CANCELLED", mergedInto: KEEP },
      });
      await writeAudit(tx, {
        action: "folio:correct-rate", entityType: "Reservation", entityId: keep.id, propertyId: keep.propertyId,
        reason: "₹2,700 per room INCLUSIVE of GST; four rooms on one bill (client confirmation 20 Oct)",
        after: { ratePaise: PER_ROOM * 4, rooms: 4 },
      });
    });
  });

  console.log("\n=== AFTER ===");
  for (const code of [KEEP, ABSORB, HKD23, "BK-9HBQP1YV"]) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code },
      select: { code: true, status: true, ratePaise: true, allocations: { select: { room: { select: { number: true } } } },
        folio: { select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } } },
    });
    const charges = r.folio!.lines.reduce((s, l) => s + BigInt(l.amountPaise) + BigInt(l.cgstPaise) + BigInt(l.sgstPaise) + BigInt(l.igstPaise), 0n);
    const bal = folioBalance(r.folio!.lines, r.folio!.payments);
    console.log(`  ${r.code} [${r.status}] rooms ${r.allocations.map((a) => a.room.number).join("+") || "—"} · charges ${inr(charges)} · balance ${inr(bal)}`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
