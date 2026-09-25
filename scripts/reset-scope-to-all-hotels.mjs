/**
 * Go-live helper: clear the stored single-property focus on all active sessions so
 * multi-property users start on "All hotels" (the new default) immediately, instead
 * of the property that the old auto-default had pinned. Run ONCE after deploying the
 * All-hotels-default change. Safe + idempotent: single-property users re-resolve to
 * their one property on the next request; multi-property users get null (All hotels).
 *
 *   node scripts/reset-scope-to-all-hotels.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
try {
  const r = await prisma.session.updateMany({
    where: { activePropertyId: { not: null } },
    data: { activePropertyId: null },
  });
  console.log(`Cleared property focus on ${r.count} session(s) → they now default to All hotels.`);
} finally {
  await prisma.$disconnect();
}
