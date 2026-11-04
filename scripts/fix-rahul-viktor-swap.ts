/**
 * HKD17 room-record swap (4 Nov 2026): both in-house 3->5 Nov, checked into each
 * other's rooms before the swap feature existed. Physically Rahul Paul
 * (BK-0ALNB6DN) is in GF-1 and Viktor Kovylin (BK-0AEK67O4) is in 2F-3; the
 * platform has them the other way round. Swap the allocations in ONE tx (delete
 * both, recreate correct). Both stay OCCUPIED; folios/rates untouched.
 *   npx tsx scripts/fix-rahul-viktor-swap.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-rahul-viktor-swap.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const d = (x: Date) => x.toISOString().slice(0, 10);

async function load(code: string) {
  const r = await prisma.reservation.findFirst({ where: { code }, select: { id: true, propertyId: true, status: true, checkInDate: true, checkOutDate: true, allocations: { select: { id: true, roomId: true, room: { select: { number: true } } } } } });
  if (!r) throw new Error(`${code} not found`);
  if (r.status !== "IN_HOUSE") throw new Error(`${code} is ${r.status}, expected IN_HOUSE`);
  if (r.allocations.length !== 1) throw new Error(`${code} has ${r.allocations.length} allocations, expected 1`);
  return r;
}

async function main() {
  const rahul = await load("BK-0ALNB6DN");  // should be in GF-1
  const viktor = await load("BK-0AEK67O4"); // should be in 2F-3
  if (rahul.propertyId !== viktor.propertyId) throw new Error("different properties");
  const pid = rahul.propertyId;
  const rooms = await prisma.room.findMany({ where: { propertyId: pid, number: { in: ["GF-1", "2F-3"] } }, select: { id: true, number: true } });
  const GF1 = rooms.find((x) => x.number === "GF-1"); const F23 = rooms.find((x) => x.number === "2F-3");
  if (!GF1 || !F23) throw new Error("GF-1/2F-3 not found");
  if (rahul.allocations[0]?.roomId !== F23.id || viktor.allocations[0]?.roomId !== GF1.id) throw new Error("rooms are not in the expected (wrong) state — already fixed?");
  const property = await prisma.property.findUniqueOrThrow({ where: { id: pid }, select: { orgId: true } });

  console.log(`Rahul  ${d(rahul.checkInDate)}->${d(rahul.checkOutDate)}  now 2F-3 → GF-1`);
  console.log(`Viktor ${d(viktor.checkInDate)}->${d(viktor.checkOutDate)}  now GF-1 → 2F-3`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      // Delete both first — same dates, so either room blocks the other on recreate.
      await tx.roomAllocation.deleteMany({ where: { reservationId: { in: [rahul.id, viktor.id] } } });
      await tx.roomAllocation.create({ data: { propertyId: pid, reservationId: rahul.id, roomId: GF1.id, startDate: rahul.checkInDate, endDate: rahul.checkOutDate } });
      await tx.roomAllocation.create({ data: { propertyId: pid, reservationId: viktor.id, roomId: F23.id, startDate: viktor.checkInDate, endDate: viktor.checkOutDate } });
      await tx.room.updateMany({ where: { id: { in: [GF1.id, F23.id] } }, data: { status: "OCCUPIED" } });
      for (const id of [rahul.id, viktor.id])
        await tx.domainEvent.create({ data: { orgId: property.orgId, propertyId: pid, type: "ReservationModified", aggregateId: id, payload: { reason: "room-record-swap" } } });
      const why = "Checked into each other's rooms before swap existed: Rahul physically in GF-1, Viktor in 2F-3. Swapped allocations — script";
      await tx.auditLog.create({ data: { orgId: property.orgId, propertyId: pid, action: "reservation:room-correct", entityType: "Reservation", entityId: rahul.id, reason: why, before: { room: "2F-3" }, after: { room: "GF-1" } } });
      await tx.auditLog.create({ data: { orgId: property.orgId, propertyId: pid, action: "reservation:room-correct", entityType: "Reservation", entityId: viktor.id, reason: why, before: { room: "GF-1" }, after: { room: "2F-3" } } });
    }, { maxWait: 10_000, timeout: 30_000 });
  });
  console.log("✅ Swapped: Rahul → GF-1, Viktor → 2F-3 (both OCCUPIED).");
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
