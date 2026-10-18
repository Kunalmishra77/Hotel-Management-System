/**
 * Restate the DailyStatSnapshot rows that MIS reads (occupancy / ADR / RevPAR /
 * revenue trend / property league / profit report).
 *
 * Two fixes land in the numbers:
 *   1. Room revenue now NETS REVERSALS. The old input summed `type='ROOM'` per
 *      business date, and a REVERSAL carries `type='REVERSAL'` on the date the
 *      correction was made — so a reversed night kept its original revenue for
 *      ever and ADR/RevPAR stayed inflated after any early check-out, rate
 *      correction or transfer.
 *   2. Room revenue now sits on the night it was earned, because the legacy
 *      aggregate lines have been re-dated onto their real nights (they had been
 *      parked on one arbitrary date — 21 Jul 2026 for the go-live import).
 *
 * Only days that ALREADY have a snapshot are recomputed: restating a derived
 * figure is right, inventing closed days that were never audited is not. Each
 * snapshot is re-derived from the same folio/allocation rows the night audit
 * would read, so this is a re-derivation, not an adjustment.
 *
 *   npx tsx scripts/rebuild-daily-snapshots.ts                      (dry-run, all)
 *   $env:CONFIRM="YES"; npx tsx scripts/rebuild-daily-snapshots.ts  (apply, all)
 *
 * Narrow it with PROPERTY_ID / FROM / TO (YYYY-MM-DD) — a whole-history pass is
 * several hundred round-trips against a pooled remote database, so after a
 * targeted repair it is worth recomputing only the dates that repair touched.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { recomputeHistoricalSnapshot, computeInputs } from "../src/features/analytics/night-audit";
import { snapshotFrom } from "../src/features/analytics/domain/metrics";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;

async function main() {
  const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const existing = await prisma.dailyStatSnapshot.findMany({
    where: {
      ...(process.env.PROPERTY_ID ? { propertyId: process.env.PROPERTY_ID } : {}),
      ...(process.env.FROM || process.env.TO
        ? {
            businessDate: {
              ...(process.env.FROM ? { gte: utc(process.env.FROM) } : {}),
              ...(process.env.TO ? { lte: utc(process.env.TO) } : {}),
            },
          }
        : {}),
    },
    select: { propertyId: true, businessDate: true, roomRevenuePaise: true, totalRevenuePaise: true, adrPaise: true, revparPaise: true, occupancyBps: true, occupiedRoomNights: true },
    orderBy: [{ propertyId: "asc" }, { businessDate: "asc" }],
  });
  const names = new Map(
    (await prisma.property.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]),
  );
  console.log(`${existing.length} snapshot(s) to re-derive\n`);

  let changed = 0;
  for (const s of existing) {
    const fresh = snapshotFrom(await computeInputs(s.propertyId, s.businessDate));
    const moved =
      fresh.roomRevenuePaise !== BigInt(s.roomRevenuePaise) ||
      fresh.totalRevenuePaise !== BigInt(s.totalRevenuePaise) ||
      fresh.adrPaise !== s.adrPaise || fresh.revparPaise !== s.revparPaise ||
      fresh.occupancyBps !== s.occupancyBps;
    if (moved) {
      changed += 1;
      console.log(`${s.businessDate.toISOString().slice(0, 10)} ${names.get(s.propertyId) ?? s.propertyId}`);
      console.log(`  room revenue ${inr(s.roomRevenuePaise)} → ${inr(fresh.roomRevenuePaise)}`);
      console.log(`  total        ${inr(s.totalRevenuePaise)} → ${inr(fresh.totalRevenuePaise)}`);
      console.log(`  ADR ${inr(s.adrPaise)} → ${inr(fresh.adrPaise)} · RevPAR ${inr(s.revparPaise)} → ${inr(fresh.revparPaise)} · occ ${pct(s.occupancyBps)} → ${pct(fresh.occupancyBps)}`);
    }
    if (APPLY) await recomputeHistoricalSnapshot(s.propertyId, s.businessDate, { force: true });
  }

  console.log(`\n${changed} of ${existing.length} snapshot(s) ${APPLY ? "restated" : "would change"}.`);
  if (!APPLY) console.log("DRY RUN — set CONFIRM=YES to apply.");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
