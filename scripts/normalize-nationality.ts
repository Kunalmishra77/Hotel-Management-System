/**
 * One spelling per nationality on existing guests (client data audit, 15 Nov
 * 2026): "IND" / "Indian" / "Inadian" → "India", "Germani" → "Germany",
 * "Rusia" → "Russia", "UK" / "England" → "United Kingdom", "norway" → "Norway"…
 * New saves are normalised by the schemas; this fixes rows written before.
 * Only Guest.nationality changes; saved Form C records (and their PDFs) are left as filed.
 *
 * Run inside the app container:
 *   npx tsx scripts/normalize-nationality.ts              (dry-run)
 *   CONFIRM=YES npx tsx scripts/normalize-nationality.ts  (apply)
 */
import { PrismaClient } from "@prisma/client";
import { canonicalNationality } from "../src/lib/nationality";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });

async function main() {
  const guests = await prisma.guest.findMany({ where: { nationality: { not: null } }, select: { id: true, nationality: true, orgId: true } });
  const changes = new Map<string, { to: string; ids: string[] }>();
  for (const g of guests) {
    const to = canonicalNationality(g.nationality);
    if (!to || to === g.nationality) continue;
    const k = g.nationality!;
    const c = changes.get(k) ?? { to, ids: [] };
    c.ids.push(g.id);
    changes.set(k, c);
  }
  let n = 0;
  for (const [from, c] of [...changes.entries()].sort((a, b) => b[1].ids.length - a[1].ids.length)) {
    console.log(`  ${JSON.stringify(from).padEnd(20)} → ${c.to.padEnd(16)} ${c.ids.length} guest(s)`);
    n += c.ids.length;
  }
  console.log(`${n} guest(s) to normalise out of ${guests.length} with a nationality.`);
  if (!APPLY) { console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  const orgId = guests[0]?.orgId;
  await prisma.$transaction(async (tx) => {
    for (const [from, c] of changes) {
      await tx.guest.updateMany({ where: { id: { in: c.ids }, nationality: from }, data: { nationality: c.to } });
    }
    if (orgId) {
      await tx.auditLog.create({ data: {
        orgId, action: "guest:normalize-nationality", entityType: "Guest", entityId: "bulk",
        // Every guest id under its old spelling — enough to undo exactly.
        before: Object.fromEntries([...changes].map(([from, c]) => [from, c.ids])),
        after: Object.fromEntries([...changes].map(([from, c]) => [from, c.to])),
        reason: "One spelling per nationality (Form C keys off it)",
      } });
    }
  });
  console.log(`✅ ${n} guest(s) updated.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
