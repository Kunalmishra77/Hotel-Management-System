/** READ-ONLY. Dump every row the Oct-2026 billing repair touches, so the repair
 *  is reversible. node scripts/backup-repair-targets.mjs > <file>.json
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const CODES = ["BK-U2BB2TP9", "BK-7SDVNJN0", "BK-9AF7GP2X", "BK-7SJDEVBJ", "BK-99OFFBL7"];

try {
  const reservations = await prisma.reservation.findMany({
    where: { code: { in: CODES } },
    include: {
      allocations: true,
      folio: { include: { lines: true, payments: true, invoices: true } },
      guest: { select: { id: true, fullName: true } },
      property: { select: { id: true, name: true, state: true, currentBusinessDate: true } },
    },
  });
  const propertyIds = [...new Set(reservations.map((r) => r.propertyId))];
  const snapshots = await prisma.dailyStatSnapshot.findMany({
    where: { propertyId: { in: propertyIds }, businessDate: { gte: new Date("2026-09-01"), lte: new Date("2026-10-31") } },
  });
  const auditRuns = await prisma.nightAuditRun.findMany({
    where: { propertyId: { in: propertyIds }, businessDate: { gte: new Date("2026-09-01"), lte: new Date("2026-10-31") } },
  });
  console.log(JSON.stringify({ takenAt: new Date().toISOString(), reservations, snapshots, auditRuns },
    (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
