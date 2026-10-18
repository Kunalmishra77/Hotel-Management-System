/**
 * Restore a room allocation for an imported stay that never got one.
 *
 * `recordHistoricalStay` allocates a room only when one is free for the WHOLE
 * range; otherwise it records the stay (dates + folio) with no allocation — a
 * documented trade-off, not a bug. But occupancy counts ALLOCATIONS while
 * revenue counts FOLIO LINES, so such a stay is invisible to occupancy and
 * RevPAR while its revenue still lands: occupancy reads low and ADR reads high
 * for every night of it.
 *
 * 11 imported stays are in that state (105 room-nights). The room is not
 * recoverable for 10 of them — the import's audit record carries no room, and the
 * folio descriptions either name none or name one another guest demonstrably
 * occupied. Those need the client's register; a guessed room would be a false
 * record of where someone slept, so this script takes the room as an argument and
 * refuses anything that clashes.
 *
 *   $env:CODE="BK-GJ7ZHS7M"; $env:ROOM="R1"; npx tsx scripts/restore-missing-allocation.ts
 *   add $env:CONFIRM="YES" to apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { writeAudit } from "../src/lib/audit";

const APPLY = process.env.CONFIRM === "YES";
const CODE = process.env.CODE;
const ROOM = process.env.ROOM;
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const key = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  if (!CODE || !ROOM) throw new Error("Set CODE and ROOM.");
  const r = await prisma.reservation.findFirstOrThrow({
    where: { code: CODE },
    select: {
      id: true, code: true, status: true, propertyId: true, checkInDate: true, checkOutDate: true, nights: true,
      guest: { select: { fullName: true } }, property: { select: { name: true, orgId: true } },
      allocations: { select: { id: true } },
    },
  });
  if (r.allocations.length > 0) { console.log(`${r.code} already has an allocation — nothing to do.`); return; }

  const room = await prisma.room.findFirstOrThrow({
    where: { propertyId: r.propertyId, number: ROOM, isActive: true },
    select: { id: true, number: true },
  });

  // Half-open overlap, the same rule the booking transaction uses.
  const clashes = await prisma.roomAllocation.findMany({
    where: { roomId: room.id, startDate: { lt: r.checkOutDate }, endDate: { gt: r.checkInDate } },
    select: { startDate: true, endDate: true, reservation: { select: { code: true, guest: { select: { fullName: true } } } } },
  });
  const blocks = await prisma.roomBlock.findMany({
    where: { roomId: room.id, startDate: { lt: r.checkOutDate }, endDate: { gt: r.checkInDate } },
    select: { startDate: true, endDate: true, reason: true },
  });

  console.log(`${r.code} ${r.guest.fullName} [${r.status}] @ ${r.property.name}`);
  console.log(`  stay ${key(r.checkInDate)} → ${key(r.checkOutDate)} (${r.nights} nights) → room ${room.number}`);
  if (clashes.length > 0 || blocks.length > 0) {
    for (const c of clashes) console.log(`  ✘ clash ${key(c.startDate)}→${key(c.endDate)} ${c.reservation.code} ${c.reservation.guest.fullName}`);
    for (const b of blocks) console.log(`  ✘ block ${key(b.startDate)}→${key(b.endDate)} ${b.reason}`);
    throw new Error("room is not free for the whole stay — refusing to create an overlapping allocation");
  }
  console.log(`  ✔ room ${room.number} is free for the whole stay · ${r.nights} room-night(s) recovered for occupancy`);

  if (!APPLY) { console.log("\nDRY RUN — set CONFIRM=YES to apply."); return; }
  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.roomAllocation.create({
        data: { propertyId: r.propertyId, reservationId: r.id, roomId: room.id, startDate: r.checkInDate, endDate: r.checkOutDate },
      });
      await writeAudit(tx, {
        action: "reservation:restore-allocation", entityType: "Reservation", entityId: r.id, propertyId: r.propertyId,
        reason: "imported stay had no allocation; room confirmed free for the whole range",
        before: { roomId: null }, after: { roomId: room.id, roomNumber: room.number },
      });
    });
  });
  console.log("Applied.");
}

main()
  .catch((e) => { console.error("FAILED:", e.message ?? e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
