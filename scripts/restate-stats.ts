/**
 * One-time: restate every past day's stats snapshot whose figures no longer match
 * the folios (back-dated corrections before restatePastSnapshots existed — rate
 * fixes, Set room rate, the 29 Oct paper-bill corrections). Each restated day is
 * audited ("stats:restate"). Days that already match are left alone.
 *   npx tsx scripts/restate-stats.ts                      (dry-run: which days differ)
 *   $env:CONFIRM="YES"; npx tsx scripts/restate-stats.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { computeInputs, restatePastSnapshots } from "../src/features/analytics/night-audit";
import { snapshotFrom } from "../src/features/analytics/domain/metrics";
import { localToday } from "../src/lib/local-day";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: bigint | number) => `₹${(Number(p) / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

async function main() {
  const today = localToday();
  const properties = await prisma.property.findMany({ where: { rooms: { some: {} } }, select: { id: true, code: true, orgId: true } });
  let totalDiff = 0;
  for (const p of properties) {
    const snaps = await prisma.dailyStatSnapshot.findMany({ where: { propertyId: p.id, businessDate: { lt: today } }, orderBy: { businessDate: "asc" } });
    const differing: Date[] = [];
    let delta = 0n;
    await runWithSystemContext(p.orgId, async () => {
      for (const s of snaps) {
        const now = snapshotFrom(await computeInputs(p.id, s.businessDate));
        if (BigInt(now.roomRevenuePaise) !== BigInt(s.roomRevenuePaise) || BigInt(now.totalRevenuePaise) !== BigInt(s.totalRevenuePaise) || now.occupiedRoomNights !== s.occupiedRoomNights || BigInt(now.expensePaise) !== BigInt(s.expensePaise)) {
          differing.push(s.businessDate);
          delta += BigInt(now.totalRevenuePaise) - BigInt(s.totalRevenuePaise);
        }
      }
    });
    totalDiff += differing.length;
    console.log(`${p.code}: ${snaps.length} past days · ${differing.length} out of date (revenue change ${delta >= 0n ? "+" : ""}${inr(delta)})${differing.length ? ` — ${differing.map((d) => d.toISOString().slice(5, 10)).join(" ")}` : ""}`);
    if (APPLY && differing.length) {
      await runWithSystemContext(p.orgId, () => restatePastSnapshots(p.id, differing, "One-time restatement: snapshot had drifted from the folios after back-dated corrections (29–30 Oct 2026)"));
    }
  }
  console.log(APPLY ? `\n✅ Restated ${totalDiff} day(s).` : `\nDRY RUN — ${totalDiff} day(s) would be restated. Re-run with CONFIRM=YES to apply.`);
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
