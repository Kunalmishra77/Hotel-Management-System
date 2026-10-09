/**
 * Sayan Sen: cancel the mistaken CONFIRMED booking (BK-IAC462Y6, 13→17 Oct, R1)
 * and extend the IN-HOUSE stay (BK-I9NJ8R3X, 05→09 Oct, R1) to 17 Oct. Mirrors the
 * Cancel + Extend server actions: release the confirmed's allocation, re-stretch R1
 * to 05→17, bill the added nights (09–16) with real GST. Idempotent + guarded.
 *
 *   npx tsx scripts/fix-sayan-extend.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-sayan-extend.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { postRoomChargeTx, type BillingPostTx } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const NEW_CO = new Date("2026-10-17T00:00:00.000Z");
const d = (x: Date) => x.toISOString().slice(0, 10);
function nightDates(ci: Date, co: Date): Date[] { const o: Date[] = []; const x = new Date(Date.UTC(ci.getUTCFullYear(), ci.getUTCMonth(), ci.getUTCDate())); const e = new Date(Date.UTC(co.getUTCFullYear(), co.getUTCMonth(), co.getUTCDate())); while (x < e) { o.push(new Date(x)); x.setUTCDate(x.getUTCDate() + 1); } return o; }

async function main() {
  const conf = await prisma.reservation.findFirst({ where: { code: "BK-IAC462Y6" }, select: { id: true, status: true, propertyId: true, property: { select: { orgId: true } }, allocations: { select: { id: true, roomId: true } } } });
  const inh = await prisma.reservation.findFirst({ where: { code: "BK-I9NJ8R3X" }, select: { id: true, status: true, propertyId: true, ratePaise: true, checkInDate: true, checkOutDate: true, folio: { select: { id: true } }, property: { select: { state: true, orgId: true } }, allocations: { select: { id: true, roomId: true, room: { select: { number: true, status: true } } } } } });
  const krz = await prisma.reservation.findFirst({ where: { code: "BK-ZNQGPSZL" }, select: { id: true, status: true, propertyId: true, checkInDate: true, checkOutDate: true, allocations: { select: { id: true, roomId: true, startDate: true, endDate: true } } } });
  if (!conf || !inh?.folio || !krz) throw new Error("bookings not found");
  const roomId = inh.allocations[0]!.roomId; // R1
  const roomNo = inh.allocations[0]!.room.number;
  const r2 = await prisma.room.findFirst({ where: { number: "R2", propertyId: inh.propertyId }, select: { id: true } });
  if (!r2) throw new Error("R2 not found");

  // Guards.
  if (inh.status !== "IN_HOUSE") throw new Error(`in-house booking is ${inh.status}`);
  if (conf.status !== "CONFIRMED" && conf.status !== "CANCELLED") throw new Error(`Sayan confirmed booking is ${conf.status}`);
  // R2 must be free for Krzysztof's dates (excluding his own allocation).
  const r2Busy = await prisma.roomAllocation.count({ where: { roomId: r2.id, reservationId: { not: krz.id }, startDate: { lt: krz.checkOutDate }, endDate: { gt: krz.checkInDate } } });
  if (r2Busy) throw new Error(`R2 is not free for ${d(krz.checkInDate)}→${d(krz.checkOutDate)}`);
  // After moving Krzysztof off R1 and cancelling Sayan's confirmed, R1 must have no OTHER overlap for 05→17.
  const conflicts = await prisma.roomAllocation.findMany({ where: { roomId, reservationId: { notIn: [inh.id, conf.id, krz.id] }, startDate: { lt: NEW_CO }, endDate: { gt: inh.checkInDate } }, select: { reservationId: true, startDate: true, endDate: true } });
  if (conflicts.length) throw new Error(`room ${roomNo} still has another overlapping allocation: ${JSON.stringify(conflicts)}`);

  const added = nightDates(inh.checkOutDate < NEW_CO ? inh.checkOutDate : NEW_CO, NEW_CO); // [09..16] if extending
  const totalNights = nightDates(inh.checkInDate, NEW_CO).length;
  const krzOnR1 = krz.allocations.some((a) => a.roomId === roomId);
  console.log(`Plan:`);
  console.log(`  0) move Krzysztof BK-ZNQGPSZL ${d(krz.checkInDate)}→${d(krz.checkOutDate)} from R1 -> R2 ${krzOnR1 ? "" : "(already moved)"}`);
  console.log(`  1) cancel ${conf.status === "CANCELLED" ? "(already cancelled) " : ""}Sayan BK-IAC462Y6 + release its ${conf.allocations.length} allocation(s)`);
  console.log(`  2) extend Sayan BK-I9NJ8R3X ${d(inh.checkInDate)}->${d(inh.checkOutDate)} ==> ${d(inh.checkInDate)}->${d(NEW_CO)} (${totalNights} nights), room ${roomNo} 05→17`);
  console.log(`  3) bill ${added.length} added night(s) [${added.map(d).join(", ")}] @ ₹${inh.ratePaise / 100} + GST`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(inh.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      if (krzOnR1) {
        await tx.roomAllocation.updateMany({ where: { reservationId: krz.id, roomId }, data: { roomId: r2!.id } });
        await tx.domainEvent.create({ data: { orgId: inh.property.orgId, propertyId: krz.propertyId, type: "ReservationModified", aggregateId: krz.id, payload: { code: "BK-ZNQGPSZL", movedRoom: "R1->R2", reason: "free R1 for Sayan extension" } } });
        await tx.auditLog.create({ data: { orgId: inh.property.orgId, propertyId: krz.propertyId, action: "reservation:reallocate-room", entityType: "Reservation", entityId: krz.id, reason: "moved R1->R2 to free R1 — script", before: { room: "R1" }, after: { room: "R2" } } });
      }
      if (conf.status === "CONFIRMED") {
        await tx.reservation.update({ where: { id: conf.id }, data: { status: "CANCELLED" } });
        await tx.roomAllocation.deleteMany({ where: { reservationId: conf.id } });
        await tx.domainEvent.create({ data: { orgId: conf.property.orgId, propertyId: conf.propertyId, type: "ReservationCancelled", aggregateId: conf.id, payload: { code: "BK-IAC462Y6", reason: "created by mistake (duplicate of extended stay)" } } });
        await tx.auditLog.create({ data: { orgId: conf.property.orgId, propertyId: conf.propertyId, action: "reservation:cancel", entityType: "Reservation", entityId: conf.id, reason: "created by mistake — script", before: { status: "CONFIRMED" }, after: { status: "CANCELLED" } } });
      }
      if (inh.checkOutDate < NEW_CO) {
        await tx.roomAllocation.deleteMany({ where: { reservationId: inh.id } });
        await tx.roomAllocation.create({ data: { propertyId: inh.propertyId, reservationId: inh.id, roomId, startDate: inh.checkInDate, endDate: NEW_CO } });
        await tx.reservation.update({ where: { id: inh.id }, data: { checkOutDate: NEW_CO, nights: totalNights } });
        await tx.room.update({ where: { id: roomId }, data: { status: "OCCUPIED" } });
        await tx.domainEvent.create({ data: { orgId: inh.property.orgId, propertyId: inh.propertyId, type: "ReservationModified", aggregateId: inh.id, payload: { code: "BK-I9NJ8R3X", checkOutDate: d(NEW_CO), extended: true } } });
        await tx.auditLog.create({ data: { orgId: inh.property.orgId, propertyId: inh.propertyId, action: "reservation:extend", entityType: "Reservation", entityId: inh.id, reason: "extend to 17 Oct — script", before: { checkOutDate: d(inh.checkOutDate) }, after: { checkOutDate: d(NEW_CO), nights: totalNights } } });
      }
    });
    // Bill added nights — one tx each (real GST), skipping any already posted.
    const have = new Set((await prisma.folioLine.findMany({ where: { folioId: inh.folio!.id, type: "ROOM" }, select: { businessDate: true } })).map((l) => d(l.businessDate)));
    let posted = 0;
    for (const bd of added) {
      if (have.has(d(bd))) continue;
      await prisma.$transaction((tx) => postRoomChargeTx(tx as unknown as BillingPostTx, { folioId: inh.folio!.id, propertyId: inh.propertyId, propertyState: inh.property.state, ratePaise: inh.ratePaise, businessDate: bd, postedById: null }));
      posted++;
    }
    console.log(`  posted ${posted} added night(s).`);
  });
  console.log("✅ Done.");
}

main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
