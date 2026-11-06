/**
 * Tarun Baajwan, BK-34B3K6F0 (HKD17, 2F-3) — booked on MakeMyTrip for 5→6 Nov,
 * extended DIRECTLY at the desk to 9 Nov on 6 Nov, before extensions carried
 * their own source. Record that extension (6→9 Nov, Direct, ₹2,100 pre-tax) so
 * revenue-by-source credits those 3 nights to Direct. The booking itself stays
 * MakeMyTrip; folio / bill untouched. Also LISTS other OTA bookings that were
 * extended in the past (read-only) so the desk can say which were direct.
 *   npx tsx scripts/fix-tarun-extension-source.ts                      (dry-run)
 *   $env:CONFIRM="YES"; npx tsx scripts/fix-tarun-extension-source.ts  (apply)
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runWithSystemContext } from "../src/lib/context";

const APPLY = process.env.CONFIRM === "YES";
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } } });
const d = (x: Date) => x.toISOString().slice(0, 10);
const FROM = new Date("2026-11-06T00:00:00Z");
const TO = new Date("2026-11-09T00:00:00Z");

async function main() {
  const r = await prisma.reservation.findFirst({
    where: { code: "BK-34B3K6F0" },
    select: { id: true, propertyId: true, source: true, status: true, checkOutDate: true, ratePaise: true, guest: { select: { fullName: true } }, property: { select: { orgId: true } }, extensions: true },
  });
  if (!r) throw new Error("BK-34B3K6F0 not found");
  if (!r.guest.fullName.toLowerCase().includes("tarun")) throw new Error(`unexpected guest ${r.guest.fullName}`);
  console.log(`${r.guest.fullName} · ${r.status} · source ${r.source} · check-out ${d(r.checkOutDate)} · rate ${r.ratePaise / 100}`);
  if (r.extensions.length) { console.log("Already has extension rows — nothing to do:", r.extensions.map((e) => `${d(e.fromDate)}→${d(e.toDate)} ${e.source}`)); }

  // Other OTA bookings extended before this feature (read-only list).
  const OTA = ["MAKEMYTRIP", "GOIBIBO", "AGODA", "BOOKING_COM", "EXPEDIA", "AIRBNB"] as const;
  const audits = await prisma.auditLog.findMany({ where: { action: "reservation:extend" }, select: { entityId: true, createdAt: true, before: true, after: true } });
  const ids = [...new Set(audits.map((a) => a.entityId).filter((x): x is string => !!x && x !== r.id))];
  const others = await prisma.reservation.findMany({
    where: { id: { in: ids }, source: { in: [...OTA] } },
    select: { id: true, code: true, source: true, checkInDate: true, checkOutDate: true, guest: { select: { fullName: true } }, property: { select: { code: true } } },
  });
  console.log(`\nOther OTA bookings extended earlier (${others.length}) — stay credited to the OTA unless told otherwise:`);
  for (const o of others) {
    const a = audits.filter((x) => x.entityId === o.id).map((x) => `${d(new Date((x.before as { checkOutDate: string }).checkOutDate))}→${d(new Date((x.after as { checkOutDate: string }).checkOutDate))}`);
    console.log(`  ${o.property.code} ${o.code} ${o.guest.fullName} · ${o.source} · ${d(o.checkInDate)}→${d(o.checkOutDate)} · extended ${a.join(", ")}`);
  }

  if (r.extensions.length) return;
  if (d(r.checkOutDate) !== d(TO)) throw new Error(`check-out is ${d(r.checkOutDate)}, expected ${d(TO)} — changed since?`);
  console.log(`\nWill record: extension ${d(FROM)}→${d(TO)} · DIRECT · ₹${r.ratePaise / 100}/night`);
  if (!APPLY) { console.log("DRY RUN — nothing written. Re-run with CONFIRM=YES to apply."); return; }

  await runWithSystemContext(r.property.orgId, async () => {
    await prisma.$transaction(async (tx) => {
      await tx.stayExtension.create({ data: { propertyId: r.propertyId, reservationId: r.id, fromDate: FROM, toDate: TO, source: "DIRECT", ratePaise: r.ratePaise } });
      await tx.domainEvent.create({ data: { orgId: r.property.orgId, propertyId: r.propertyId, type: "ReservationModified", aggregateId: r.id, payload: { reason: "extension-source", extensionSource: "DIRECT" } } });
      await tx.auditLog.create({ data: { orgId: r.property.orgId, propertyId: r.propertyId, action: "reservation:extension-source", entityType: "Reservation", entityId: r.id, reason: "MMT 5→6 Nov booking extended directly 6→9 Nov before extensions had a source — script", before: { extensionSource: r.source }, after: { from: d(FROM), to: d(TO), extensionSource: "DIRECT" } } });
    });
  });
  console.log("✅ Recorded: 6→9 Nov nights are Direct; booking stays MakeMyTrip.");
}
main().catch((e) => { console.error("Failed:", e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
