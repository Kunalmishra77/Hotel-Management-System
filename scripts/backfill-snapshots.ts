/**
 * One-off: backfill DailyStatSnapshot for recent dates the night audit never closed
 * (the live worker hasn't been running). Uses recomputeHistoricalSnapshot — it only
 * upserts the analytics snapshot from existing rows; it does NOT post folio charges,
 * mark no-shows, or lock the day. Safe to re-run (idempotent; skips COMPLETED runs).
 *
 *   npx tsx scripts/backfill-snapshots.ts            # default window below
 *   FROM=2026-09-26 TO=2026-10-01 npx tsx scripts/backfill-snapshots.ts
 */
import "dotenv/config";
import { db } from "../src/lib/db";
import { recomputeHistoricalSnapshot } from "../src/features/analytics/night-audit";

const DAY = 86_400_000;
const parse = (s: string | undefined, fb: string) => new Date(`${s ?? fb}T00:00:00.000Z`);

async function main() {
  const from = parse(process.env.FROM, "2026-09-26");
  const to = parse(process.env.TO, new Date().toISOString().slice(0, 10));
  const props = await db.unscoped().property.findMany({ select: { id: true, name: true } });
  console.log(`Backfilling ${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)} for ${props.length} properties…`);
  let n = 0;
  for (const pr of props) {
    for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
      await recomputeHistoricalSnapshot(pr.id, new Date(t));
      n++;
    }
    console.log(`  ✔ ${pr.name}`);
  }
  console.log(`Done — ${n} snapshot(s) recomputed.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
