/**
 * One-off cleanup for the POS direct-sale re-billing bug: close any currently-open
 * DIRECT_SALE "house" folios so the next walk-in starts a FRESH folio instead of
 * reusing an accumulated one (which made each new invoice re-bill prior sales).
 * After this + the code fix, every walk-in gets exactly one correct bill.
 *
 * Idempotent, safe (only flips isClosed on DIRECT_SALE folios; no financial rows).
 *   node scripts/close-open-direct-sale-folios.mjs
 */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
try {
  const open = await prisma.folio.findMany({
    where: { kind: "DIRECT_SALE", isClosed: false },
    select: { id: true, propertyId: true, _count: { select: { lines: true } } },
  });
  if (open.length === 0) {
    console.log("No open direct-sale folios — nothing to close.");
  } else {
    const res = await prisma.folio.updateMany({ where: { id: { in: open.map((f) => f.id) } }, data: { isClosed: true } });
    console.log(`Closed ${res.count} open direct-sale folio(s):`);
    for (const f of open) console.log(`  - ${f.id} (property ${f.propertyId}, ${f._count.lines} line(s))`);
    console.log("Next walk-in POS sale will open a fresh folio.");
  }
} catch (e) {
  console.error("Failed:", e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
