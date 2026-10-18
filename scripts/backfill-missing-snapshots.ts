/**
 * Backfill the DailyStatSnapshot rows that were never written.
 *
 * Every range-based MIS figure — revenue trend, property league, the profit
 * report's occupancy/ADR/RevPAR — sums SNAPSHOTS, not folio rows. So a business
 * day whose night audit never ran is simply absent from those reports: its
 * revenue and its occupied room-nights are silently dropped, which understates
 * revenue AND distorts every average computed over the range.
 *
 * `recomputeHistoricalSnapshot` already exists for exactly this (the go-live
 * import calls it per night of a back-dated stay). This sweeps the days that
 * slipped through.
 *
 * Only days the hotel was actually OPERATING are filled — a day with active room
 * revenue or an occupied allocation. Filling every calendar day instead would
 * invent 0%-occupancy days from before a property went live and drag down every
 * average. Today is skipped too: the business date is still open, and the night
 * audit closes it.
 *
 *   npx tsx scripts/backfill-missing-snapshots.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/backfill-missing-snapshots.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { recomputeHistoricalSnapshot, computeInputs } from "../src/features/analytics/night-audit";
import { snapshotFrom } from "../src/features/analytics/domain/metrics";
import { revenueForBusinessDate } from "../src/features/billing/night-audit";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const inr = (p: number | bigint) => `₹${(Number(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const key = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  // Hotels only — the office / head-office / "Other" cost centres have no rooms
  // and no room-nights, so a snapshot for them would be meaningless.
  const hotels = await prisma.property.findMany({
    where: { rooms: { some: {} } },
    select: { id: true, name: true, currentBusinessDate: true },
  });

  let filled = 0;
  const anomalies: string[] = [];
  for (const h of hotels) {
    const open = h.currentBusinessDate ? key(h.currentBusinessDate) : key(new Date());
    const have = new Set(
      (await prisma.dailyStatSnapshot.findMany({ where: { propertyId: h.id }, select: { businessDate: true } }))
        .map((s) => key(s.businessDate)),
    );

    // Days the hotel was operating: active room revenue, or someone in a room.
    const roomLines = await prisma.folioLine.findMany({
      where: { folio: { propertyId: h.id }, type: "ROOM" },
      select: { id: true, businessDate: true, reversalOfId: true },
    });
    const reversed = new Set(
      (await prisma.folioLine.findMany({ where: { folio: { propertyId: h.id }, reversalOfId: { in: roomLines.map((l) => l.id) } }, select: { reversalOfId: true } }))
        .map((l) => l.reversalOfId),
    );
    const candidates = new Set(roomLines.filter((l) => !reversed.has(l.id)).map((l) => key(l.businessDate)));

    const allocs = await prisma.roomAllocation.findMany({
      where: { propertyId: h.id, reservation: { status: { in: ["IN_HOUSE", "CHECKED_OUT"] } } },
      select: { startDate: true, endDate: true },
    });
    for (const a of allocs) {
      for (let t = a.startDate.getTime(); t < a.endDate.getTime(); t += 86_400_000) candidates.add(key(new Date(t)));
    }

    const missing = [...candidates].filter((k) => !have.has(k) && k < open).sort();
    if (missing.length === 0) { console.log(`${h.name}: nothing missing`); continue; }

    console.log(`\n${h.name}: ${missing.length} candidate day(s)`);
    for (const k of missing) {
      const date = new Date(`${k}T00:00:00.000Z`);
      const rev = await revenueForBusinessDate(h.id, date);
      const stats = snapshotFrom(await computeInputs(h.id, date));
      const line = `  ${k}  room ${inr(rev.roomPaise)} · occ ${stats.occupiedRoomNights}/${stats.availableRoomNights} (${(stats.occupancyBps / 100).toFixed(2)}%) · ADR ${inr(stats.adrPaise)}`;

      // Revenue with NOBODY in a room means the charge is mis-dated, not that the
      // hotel traded that day — go-live charges were posted against the property's
      // then-current business date (21 Jul 2026) rather than the night they belong
      // to. Writing a snapshot there would move that revenue INTO July in MIS.
      // Skipped and reported; the dates themselves need a separate decision.
      if (stats.occupiedRoomNights === 0) {
        console.log(`${line}   ← SKIPPED: revenue but no occupancy (mis-dated charge)`);
        anomalies.push(`${h.name} ${k}: ${inr(rev.roomPaise)} room revenue with 0 occupied room-nights`);
        continue;
      }
      console.log(line);
      if (APPLY) await recomputeHistoricalSnapshot(h.id, date, { force: true });
      filled += 1;
    }
  }

  if (anomalies.length > 0) {
    console.log("\nNOT backfilled — mis-dated revenue, needs a decision on which night it belongs to:");
    for (const a of anomalies) console.log(`  · ${a}`);
  }
  console.log(`\n${filled} snapshot(s) ${APPLY ? "written" : "would be written"}.`);
  if (!APPLY) console.log("DRY RUN — set CONFIRM=YES to apply.");
}

main()
  .catch((e) => { console.error("FAILED:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
