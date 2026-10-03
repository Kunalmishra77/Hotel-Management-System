/**
 * Turn ON day-use (same-day check-in = check-out) for all properties, so a guest
 * who arrives and leaves the same day can be booked without forcing an overnight.
 * Idempotent.
 *   node scripts/enable-day-use.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  const res = await prisma.property.updateMany({ where: { deletedAt: null, dayUseEnabled: false }, data: { dayUseEnabled: true } });
  console.log(`✅ Enabled day-use on ${res.count} property(ies).`);
  const all = await prisma.property.findMany({ where: { deletedAt: null }, select: { name: true, dayUseEnabled: true } });
  for (const p of all) console.log(`  ${p.name}: dayUseEnabled=${p.dayUseEnabled}`);
} catch (e) {
  console.error("Failed:", e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
