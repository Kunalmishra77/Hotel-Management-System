/**
 * Clean up leftover INACTIVE demo rooms that inflate room counts (e.g. D-1/17 shows
 * 19 rooms but only ~9 are real — the extra ones are old inactive Deluxe/Suite demo
 * rooms). This deletes ONLY rooms that are:
 *   - isActive = false, AND
 *   - have NO reservations/allocations, AND
 *   - have NO room blocks
 * so nothing with real history is ever touched. Safe + idempotent.
 *
 * Dry-run first (default): lists what WOULD be deleted, deletes nothing.
 *   node scripts/remove-inactive-demo-rooms.mjs
 * Then, to actually delete:
 *   CONFIRM=YES node scripts/remove-inactive-demo-rooms.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const confirm = process.env.CONFIRM === "YES";

try {
  const candidates = await prisma.room.findMany({
    where: {
      isActive: false,
      allocations: { none: {} },
      blocks: { none: {} },
    },
    select: { id: true, number: true, property: { select: { name: true } }, category: { select: { name: true } } },
    orderBy: [{ propertyId: "asc" }, { number: "asc" }],
  });

  if (candidates.length === 0) {
    console.log("Nothing to clean — no inactive rooms without history.");
  } else {
    console.log(`${candidates.length} inactive demo room(s) with no bookings/blocks:`);
    for (const r of candidates) console.log(`  - ${r.property.name} · ${r.number} (${r.category?.name ?? "—"})`);
    if (!confirm) {
      console.log("\nDRY-RUN. Nothing deleted. Re-run with  CONFIRM=YES  to delete these.");
    } else {
      const ids = candidates.map((r) => r.id);
      const res = await prisma.room.deleteMany({ where: { id: { in: ids } } });
      console.log(`\n✅ Deleted ${res.count} inactive demo room(s). Room counts are now correct.`);
    }
  }
} catch (e) {
  console.error("Failed:", e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
