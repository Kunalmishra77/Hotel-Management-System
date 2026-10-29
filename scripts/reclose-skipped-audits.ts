/**
 * Re-close the business days whose night audit was skipped because Data Entry had
 * already written a provisional snapshot (HKD3 22 Oct; HKD17 + HKD3 27 Oct 2026).
 * Verified beforehand: every stayed night was billed and no arrival was left
 * un-handled, so the full audit (which would post charges for TODAY's in-house
 * guests onto the past date) must NOT be re-run. Only the safe parts: rebuild the
 * day's snapshot from the folios/allocations, and record the run as COMPLETED.
 *   npx tsx scripts/reclose-skipped-audits.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/reclose-skipped-audits.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { recomputeHistoricalSnapshot } from "../src/features/analytics/night-audit";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const DAYS: [string, string][] = [["HKD3", "2026-10-22"], ["HKD17", "2026-10-27"], ["HKD3", "2026-10-27"]];

async function main() {
  for (const [code, day] of DAYS) {
    const p = await prisma.property.findFirstOrThrow({ where: { code }, select: { id: true, orgId: true } });
    const businessDate = new Date(`${day}T00:00:00.000Z`);
    const run = await prisma.nightAuditRun.findUnique({ where: { propertyId_businessDate: { propertyId: p.id, businessDate } }, select: { status: true } });
    if (run) { console.log(`${code} ${day}: run already ${run.status} — skip`); continue; }
    console.log(`${code} ${day}: rebuild snapshot + record run COMPLETED`);
    if (!APPLY) continue;
    await runWithSystemContext(p.orgId, async () => {
      await recomputeHistoricalSnapshot(p.id, businessDate, { force: true });
      await prisma.nightAuditRun.create({ data: { propertyId: p.id, businessDate, status: "COMPLETED", startedAt: new Date(), completedAt: new Date() } });
      await prisma.auditLog.create({ data: { orgId: p.orgId, propertyId: p.id, action: "night-audit:reclose", entityType: "NightAuditRun", entityId: `${p.id}:${day}`, reason: "Audit was skipped (provisional Data Entry snapshot). Verified all nights billed + no missed arrivals; snapshot rebuilt and day recorded closed — script", after: { businessDate: day } } });
    });
  }
  if (!APPLY) console.log("\nDRY RUN — nothing written. Re-run with CONFIRM=YES to apply.");
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
