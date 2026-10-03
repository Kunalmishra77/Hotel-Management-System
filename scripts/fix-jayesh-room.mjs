/**
 * Free Jayesh Agarawal's room: he checked in and out the SAME day, but the booking
 * was forced to check-out tomorrow, so the room allocation still blocks tonight.
 * This shrinks the stay to a same-day (day-use) stay: allocation + reservation
 * check-out set to the check-in date, so the room is free for tonight. Billed
 * nights stay 1 (day-use = 1 day). Idempotent.
 *   node scripts/fix-jayesh-room.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  const g = await prisma.guest.findFirst({ where: { fullName: { contains: "Jayesh" } }, select: { id: true } });
  if (!g) { console.log("No guest 'Jayesh' found."); process.exit(0); }
  const res = await prisma.reservation.findFirst({
    where: { guestId: g.id }, orderBy: { createdAt: "desc" },
    select: { id: true, code: true, checkInDate: true, checkOutDate: true, allocations: { select: { id: true, room: { select: { number: true } } } } },
  });
  if (!res) { console.log("No reservation for Jayesh."); process.exit(0); }
  const sameDay = res.checkInDate; // set check-out = check-in (day-use)

  if (res.checkOutDate.getTime() > res.checkInDate.getTime()) {
    await prisma.reservation.update({ where: { id: res.id }, data: { checkOutDate: sameDay } });
    for (const a of res.allocations) {
      await prisma.roomAllocation.update({ where: { id: a.id }, data: { endDate: sameDay } });
      console.log(`Freed room ${a.room.number} for tonight (allocation now ends ${sameDay.toISOString().slice(0, 10)}).`);
    }
    console.log(`✅ ${res.code} is now a same-day (day-use) stay — room available tonight.`);
  } else {
    console.log(`${res.code} is already same-day — nothing to change.`);
  }
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
