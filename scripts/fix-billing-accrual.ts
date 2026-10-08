/**
 * One-time remediation for the night-audit outage (business date frozen at
 * 2026-07-21; room-nights never accrued). Run via tsx so it reuses the EXACT
 * server GST + posting logic:
 *
 *   npx tsx scripts/fix-billing-accrual.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-billing-accrual.ts  (apply)
 *
 * Per active hotel:
 *  1) Reset currentBusinessDate -> today (property-local) so new charges date
 *     correctly and the night audit resumes from now (never replays 79 days).
 *  2) Backfill each CURRENT in-house folio with the MISSING booked room-nights
 *     (dates that have NO room line yet), at the reservation's rate. Idempotent:
 *     already-posted dates are skipped (and the ROOM (folioId, businessDate)
 *     unique index is respected — we never collide).
 *
 * SAFETY GUARD: a folio with any room line dated OUTSIDE its stay (e.g. a
 * rate-correction consolidated onto the frozen 2026-07-21 date) is NOT touched —
 * it is FLAGGED for manual review, so we can never double-charge it. Payments and
 * non-room charges are never touched.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";
import { postRoomChargeTx, type BillingPostTx } from "../src/features/billing";

const APPLY = process.env.CONFIRM === "YES";
// Use the DIRECT (session-mode) connection, not the transaction pooler — interactive
// $transaction()s break over pgbouncer transaction mode ("Transaction not found").
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const key = (d: Date) => d.toISOString().slice(0, 10);
const inr = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

function stayNightDates(checkIn: Date, checkOut: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate()));
  const end = new Date(Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate()));
  while (d < end) { out.push(new Date(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

async function main() {
  const props = await prisma.property.findMany({
    where: { isActive: true, deletedAt: null, isCostCenter: false },
    select: { id: true, code: true, state: true, orgId: true, timezone: true, currentBusinessDate: true },
    orderBy: { code: "asc" },
  });

  let posted = 0, postedPaise = 0;
  const flagged: string[] = [];
  for (const p of props) {
    const tz = p.timezone ?? "Asia/Kolkata";
    const today = new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: tz })}T00:00:00.000Z`);
    console.log(`\n=== ${p.code} === currentBusinessDate ${key(p.currentBusinessDate ?? new Date(0))} -> ${key(today)}`);
    if (APPLY) await prisma.property.update({ where: { id: p.id }, data: { currentBusinessDate: today } });

    const inHouse = await prisma.reservation.findMany({
      where: { propertyId: p.id, status: "IN_HOUSE" },
      select: { id: true, code: true, ratePaise: true, checkInDate: true, checkOutDate: true, folio: { select: { id: true } } },
      orderBy: { checkInDate: "asc" },
    });
    for (const r of inHouse) {
      if (!r.folio) { console.log(`  ${r.code}: no folio — skip`); continue; }
      const nights = stayNightDates(r.checkInDate, r.checkOutDate);
      const toCharge = nights.length > 0 ? nights : [r.checkInDate];
      const inRange = new Set(toCharge.map(key));

      const roomRows = await prisma.folioLine.findMany({ where: { folioId: r.folio.id, type: "ROOM" }, select: { businessDate: true } });
      const postedDates = new Set(roomRows.map((l) => key(l.businessDate)));
      const outOfRange = [...postedDates].filter((dk) => !inRange.has(dk));
      if (outOfRange.length > 0) {
        flagged.push(`${p.code}/${r.code} (room line(s) dated ${outOfRange.join(", ")} outside ${key(r.checkInDate)}..${key(r.checkOutDate)})`);
        console.log(`  ${r.code}: ⚠ FLAGGED — room line(s) outside stay (${outOfRange.join(", ")}); needs manual review, NOT touched`);
        continue;
      }

      const missing = toCharge.filter((d) => !postedDates.has(key(d)));
      const amt = missing.length * r.ratePaise;
      console.log(`  ${r.code}: ${key(r.checkInDate)}->${key(r.checkOutDate)} booked ${toCharge.length}n, have ${postedDates.size}, MISSING ${missing.length}n @ ${inr(r.ratePaise)} = ${inr(amt)} + GST`);
      if (missing.length === 0 || r.ratePaise <= 0) continue;
      if (!APPLY) { posted += missing.length; postedPaise += amt; continue; }
      // ONE transaction per night (like the night audit) — a long interactive
      // transaction would time out / drop over the pooler on a 97-night folio.
      let ok = 0;
      await runWithSystemContext(p.orgId, async () => {
        for (const businessDate of missing) {
          try {
            await prisma.$transaction(async (tx) => {
              await postRoomChargeTx(tx as unknown as BillingPostTx, {
                folioId: r.folio!.id, propertyId: p.id, propertyState: p.state,
                ratePaise: r.ratePaise, businessDate, postedById: null,
              });
            });
            ok += 1;
          } catch (e) {
            // A duplicate (idempotent re-run) is fine; anything else is surfaced.
            const msg = (e as Error).message;
            if (/Unique constraint|duplicate key/i.test(msg)) continue;
            console.log(`    ⚠ ${key(businessDate)}: ${msg.split("\n")[0]}`);
          }
        }
      });
      posted += ok; postedPaise += ok * r.ratePaise;
      console.log(`    ✅ posted ${ok}/${missing.length} night(s)`);
    }
  }
  console.log(`\n${APPLY ? "APPLIED" : "DRY RUN"} — ${posted} room-night(s) ${APPLY ? "posted" : "to post"}, ${inr(postedPaise)} + GST.`);
  if (flagged.length) { console.log(`\n⚠ ${flagged.length} folio(s) FLAGGED for manual review (not touched):`); for (const f of flagged) console.log("   - " + f); }
  if (!APPLY) console.log("\nRe-run with CONFIRM=YES to apply.");
}

main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
