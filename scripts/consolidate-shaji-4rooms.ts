/**
 * Shaji — put all four rooms of the 18→19 Oct stay on ONE booking and ONE bill.
 *
 * The stay was entered as two bookings against two duplicate guest records:
 * 3F-1+3F-2+3F-3 on BK-9HQHMWEJ ("Shaji") and GF-3 on BK-DKSP95KC ("Shaji
 * Paul"). One guest, one night, one party — so one folio and one GST invoice, as
 * the client asked.
 *
 * GF-3 moves onto BK-9HQHMWEJ with its payment, its own charge is reversed, and
 * the emptied booking is CANCELLED so it stops counting as a separate stay in
 * visits and room-nights. Rate becomes 4 × ₹2,700 = ₹10,800/night + GST.
 *
 * Money, after the re-pricing agreed with the client (20 Oct 2026):
 *
 *   4 rooms × (₹2,700 + ₹135)                      ₹11,340.00
 *   already on these two folios                     ₹4,907.69
 *   overpaid on the D-1/23 stay, moved across       ₹4,190.00
 *   cash taken but never recorded (client)          ₹2,242.31
 *                                                  ───────────
 *                                                  ₹11,340.00 → balance ₹0
 *
 * The D-1/23 stay settles to ₹0 at the same time. Nothing is invented: the
 * ₹4,190 is the guest's own overpayment moving to their own underpaid folio, and
 * the ₹2,242.31 is cash the client confirms was collected.
 *
 * Invoices are NOT touched here. WASPL :812, :813 and :819 all now disagree with
 * their folios; the folio screen already flags that ("Bill is out of date") and
 * offers Void & revise → Generate GST invoice, which keeps the gap-free numbering
 * inside the app where it belongs.
 *
 *   npx tsx scripts/consolidate-shaji-4rooms.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/consolidate-shaji-4rooms.ts  (apply)
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

const KEEP = "BK-9HQHMWEJ";      // the booking that ends up holding all four rooms
const ABSORB = "BK-DKSP95KC";    // GF-3, folded into KEEP and cancelled
const OVERPAID = "BK-9H8JR1PZ";  // D-1/23 — its excess moves to KEEP
const PER_ROOM = 270_000;
const ROOMS = 4;
const UNRECORDED_CASH = 224_231; // ₹2,242.31, taken but never entered (client, 20 Oct)

const LINE_SELECT = {
  id: true, type: true, description: true, quantity: true, unitPaise: true, amountPaise: true,
  taxRateBps: true, cgstPaise: true, sgstPaise: true, igstPaise: true, hsnSac: true,
  placeOfSupplyState: true, businessDate: true, revision: true, reversalOfId: true,
} as const;
const RES_SELECT = {
  id: true, code: true, status: true, propertyId: true, ratePaise: true, checkInDate: true, checkOutDate: true,
  guestId: true, property: { select: { orgId: true, name: true, state: true } },
  allocations: { select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { number: true } } } },
  folio: { select: { id: true, lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { id: true, amountPaise: true, mode: true, isRefund: true, receivedAt: true } } } },
} as const;

async function main() {
  const keep = await prisma.reservation.findFirstOrThrow({ where: { code: KEEP }, select: RES_SELECT });
  const absorb = await prisma.reservation.findFirstOrThrow({ where: { code: ABSORB }, select: RES_SELECT });
  const over = await prisma.reservation.findFirstOrThrow({ where: { code: OVERPAID }, select: RES_SELECT });
  const orgId = keep.property.orgId;

  const target = PER_ROOM * ROOMS;
  const bps = roomGstBps(PER_ROOM);
  const gst = computeGst(target, bps, keep.property.state, keep.property.state);

  const keepRows = await prisma.folioLine.findMany({ where: { folioId: keep.folio!.id }, select: LINE_SELECT });
  const absorbRows = await prisma.folioLine.findMany({ where: { folioId: absorb.folio!.id }, select: LINE_SELECT });

  const overBal = folioBalance(over.folio!.lines, over.folio!.payments);
  const excess = -overBal; // positive when overpaid

  console.log(`KEEP   ${keep.code}  rooms ${keep.allocations.map((a) => a.room.number).join("+")}  rate ${inr(keep.ratePaise)} → ${inr(target)} (${ROOMS} × ${inr(PER_ROOM)})`);
  console.log(`ABSORB ${absorb.code}  rooms ${absorb.allocations.map((a) => a.room.number).join("+")}  → folded in, then CANCELLED`);
  console.log(`D-1/23 ${over.code}  balance ${inr(overBal)}  → ${inr(excess)} excess moves to ${keep.code}`);
  if (excess <= 0n) console.log("  (nothing to move — that folio is not in credit)");

  const inserts: Prisma.FolioLineUncheckedCreateInput[] = [];

  // Re-price KEEP's room-night(s) from 3 rooms to 4.
  const seen = keepRows.map((l) => ({ type: l.type, businessDate: l.businessDate, revision: l.revision }));
  for (const l of activeLines(keepRows).filter((l) => l.type === "ROOM")) {
    if (l.unitPaise === target) continue;
    inserts.push({
      folioId: keep.folio!.id, type: "REVERSAL",
      description: `Reversal: ${l.description} (all four rooms on one bill)`,
      quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
      cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
      hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
      businessDate: new Date(), reversalOfId: l.id,
    });
    const rev = nextRoomRevision(seen as never, l.businessDate);
    seen.push({ type: "ROOM", businessDate: l.businessDate, revision: rev });
    inserts.push({
      folioId: keep.folio!.id, type: "ROOM",
      description: "Rooms 3F-1+3F-2+3F-3+GF-3 · night (4 rooms @ ₹2,700 + GST)",
      quantity: 1, unitPaise: target, amountPaise: BigInt(target), taxRateBps: bps,
      cgstPaise: gst.cgstPaise, sgstPaise: gst.sgstPaise, igstPaise: gst.igstPaise,
      hsnSac: "996311", placeOfSupplyState: keep.property.state,
      businessDate: l.businessDate, revision: rev,
    });
    console.log(`  ${dateKey(l.businessDate)} room charge ${inr(l.unitPaise)} → ${inr(target)}`);
  }

  // Reverse ABSORB's own room charge — the room is billed on KEEP now.
  for (const l of activeLines(absorbRows).filter((l) => l.type === "ROOM")) {
    inserts.push({
      folioId: absorb.folio!.id, type: "REVERSAL",
      description: `Reversal: ${l.description} (room moved to ${keep.code})`,
      quantity: 1, unitPaise: -l.unitPaise, amountPaise: -l.amountPaise, taxRateBps: l.taxRateBps,
      cgstPaise: -l.cgstPaise, sgstPaise: -l.sgstPaise, igstPaise: -l.igstPaise,
      hsnSac: l.hsnSac, placeOfSupplyState: l.placeOfSupplyState,
      businessDate: new Date(), reversalOfId: l.id,
    });
    console.log(`  ${absorb.code}: reverse ${inr(l.amountPaise)} room charge`);
  }

  const absorbPaid = absorb.folio!.payments.reduce((s, x) => s + (x.isRefund ? -BigInt(x.amountPaise) : BigInt(x.amountPaise)), 0n);
  console.log(`  ${absorb.code}: move ${inr(absorbPaid)} of payments to ${keep.code}`);
  console.log(`  ${keep.code}: record ${inr(UNRECORDED_CASH)} cash taken but never entered`);

  if (!APPLY) { console.log(`\n${inserts.length} folio line(s) + allocation move + 3 payment moves. DRY RUN — set CONFIRM=YES.`); return; }

  await runWithSystemContext(orgId, async () => {
    await prisma.$transaction(async (tx) => {
      for (const data of inserts) await tx.folioLine.create({ data });

      // GF-3 becomes a room of the kept booking.
      for (const a of absorb.allocations) {
        await tx.roomAllocation.delete({ where: { id: a.id } });
        await tx.roomAllocation.create({
          data: { propertyId: keep.propertyId, reservationId: keep.id, roomId: a.roomId, startDate: a.startDate, endDate: a.endDate },
        });
      }
      await tx.reservation.update({ where: { id: keep.id }, data: { ratePaise: target } });

      const move = async (fromFolio: string, fromProp: string, amount: bigint, label: string, receivedAt?: Date) => {
        const batch = randomUUID();
        await tx.payment.create({ data: { propertyId: fromProp, folioId: fromFolio, mode: "CASH", amountPaise: amount, isRefund: true, settlementBatchId: batch, reference: `Moved to ${keep.code} — ${label}` }, select: { id: true } });
        await tx.payment.create({ data: { propertyId: keep.propertyId, folioId: keep.folio!.id, mode: "CASH", amountPaise: amount, isRefund: false, settlementBatchId: batch, reference: label, ...(receivedAt ? { receivedAt } : {}) }, select: { id: true } });
      };
      if (absorbPaid > 0n) await move(absorb.folio!.id, absorb.propertyId, absorbPaid, `GF-3 payment (was ${absorb.code})`, absorb.folio!.payments[0]?.receivedAt);
      if (excess > 0n) await move(over.folio!.id, over.propertyId, excess, `overpayment on ${over.code}`);

      // Cash the client confirms was collected but never entered.
      await tx.payment.create({
        data: { propertyId: keep.propertyId, folioId: keep.folio!.id, mode: "CASH", amountPaise: BigInt(UNRECORDED_CASH), isRefund: false, reference: "Cash collected at the desk, recorded 20 Oct" },
        select: { id: true },
      });

      // The emptied booking is not a stay any more.
      await tx.reservation.update({
        where: { id: absorb.id },
        data: { status: "CANCELLED", notes: `Merged into ${keep.code} — one guest, one 4-room stay on 18–19 Oct; GF-3 and its payment moved there.` },
      });
      await writeAudit(tx, {
        action: "reservation:modify", entityType: "Reservation", entityId: absorb.id, propertyId: absorb.propertyId,
        reason: "duplicate booking for the same guest's 4-room stay; folded into " + keep.code,
        before: { status: absorb.status, rooms: absorb.allocations.map((a) => a.room.number) },
        after: { status: "CANCELLED", mergedInto: keep.code },
      });
      await writeAudit(tx, {
        action: "folio:move-credit", entityType: "Reservation", entityId: keep.id, propertyId: keep.propertyId,
        reason: "4 rooms consolidated onto one folio and one bill (client instruction)",
        after: { ratePaise: target, rooms: ROOMS, unrecordedCashPaise: UNRECORDED_CASH },
      });
    });
  });

  console.log("\n=== AFTER ===");
  for (const code of [KEEP, ABSORB, OVERPAID]) {
    const r = await prisma.reservation.findFirstOrThrow({
      where: { code },
      select: { code: true, status: true, ratePaise: true, allocations: { select: { room: { select: { number: true } } } },
        folio: { select: { lines: { select: { amountPaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true } }, payments: { select: { amountPaise: true, isRefund: true } } } } },
    });
    console.log(`  ${r.code} [${r.status}] rooms ${r.allocations.map((a) => a.room.number).join("+") || "—"} rate ${inr(r.ratePaise)} → balance ${inr(folioBalance(r.folio!.lines, r.folio!.payments))}`);
  }
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
