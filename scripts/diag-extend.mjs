/** READ-ONLY: why can't a guest's stay be extended? Booking, rooms, what holds the next nights. */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
const name = process.argv[2];
const d = (x) => x.toISOString().slice(0, 10);
const rs = await prisma.reservation.findMany({
  where: { guest: { fullName: { contains: name, mode: "insensitive" } } },
  select: { id: true, code: true, status: true, source: true, checkInDate: true, checkOutDate: true, ratePaise: true, propertyId: true, property: { select: { code: true } }, guest: { select: { fullName: true } },
    allocations: { select: { roomId: true, startDate: true, endDate: true, room: { select: { number: true, status: true, isActive: true } } } } },
  orderBy: { checkInDate: "desc" },
});
for (const r of rs) {
  console.log(`${r.code} [${r.status}] ${r.source} ${r.guest.fullName} @${r.property.code} ${d(r.checkInDate)}→${d(r.checkOutDate)} rate ₹${r.ratePaise / 100}`);
  for (const a of r.allocations) {
    console.log(`   room ${a.room.number} (${a.room.status}${a.room.isActive ? "" : ", INACTIVE"}) ${d(a.startDate)}→${d(a.endDate)}`);
    const next = await prisma.roomAllocation.findMany({ where: { roomId: a.roomId, reservationId: { not: r.id }, endDate: { gt: r.checkOutDate }, startDate: { lt: new Date(r.checkOutDate.getTime() + 14 * 864e5) } },
      select: { startDate: true, endDate: true, reservation: { select: { code: true, status: true, guest: { select: { fullName: true } } } } }, orderBy: { startDate: "asc" } });
    for (const n of next) console.log(`      next on this room: ${n.reservation.code} [${n.reservation.status}] ${n.reservation.guest.fullName} ${d(n.startDate)}→${d(n.endDate)}`);
    const blocks = await prisma.roomBlock.findMany({ where: { roomId: a.roomId, endDate: { gt: r.checkOutDate } }, select: { startDate: true, endDate: true, reason: true } });
    for (const b of blocks) console.log(`      block: ${d(b.startDate)}→${d(b.endDate)} ${b.reason}`);
  }
}
const audits = await prisma.auditLog.findMany({ where: { entityId: { in: rs.map((r) => r.id) } }, orderBy: { createdAt: "desc" }, take: 8, select: { action: true, createdAt: true, reason: true } });
console.log("recent audit:", audits.map((a) => `${a.createdAt.toISOString().slice(0, 16)} ${a.action}`));
await prisma.$disconnect();
